import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { DEFAULT_CRITERIA } from '../../migration/src/lib/admin/aop-editor.js';
import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Prompt 35: the Art of Possibility as one calm screen, in the BUILT participant page against the mocked SharePoint REST, with the manager's sample (13
// sub-processes by the five default criteria). At an iPad in landscape and in portrait, a 1366 x 650 laptop and a 390 px phone: no sideways scroll, the page
// is the one thing that scrolls, every criterion heading is shown whole, boxes are 48 px, the headings stay in view, the first-box bubble shows once, the
// notes open beside their heading, the strip counts, and what is stored is what Prompt 34 stored for the same ratings.

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

  test('press and hold opens the choices and never also rates; the keys; Escape; Undo (laptop)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES.laptop);
    await expect(page.getByText('Tap a box to rate it. Press and hold for choices.')).toBeVisible();
    await expect(page.getByTestId('matrix-teach')).toHaveText('Tap to rate. Press and hold for choices.');
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    const menu = page.getByRole('menu');

    // Hold: the ring fills, the choices open, and letting go does not also rate. A frame strip of the hold is kept for the report.
    const at = (await gl.boundingBox())!;
    const clip = { x: at.x - 24, y: at.y - 24, width: at.width + 48, height: at.height + 140 };
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    for (const ms of [0, 200, 400]) {
      await page.screenshot({ path: `${shots}hold-${String(ms).padStart(3, '0')}ms.png`, clip });
      await page.waitForTimeout(200);
    }
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `${shots}hold-open.png`, clip });
    await page.mouse.up();
    await expect(menu).toBeVisible();
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(page.getByTestId('matrix-teach')).toHaveCount(0);
    await expect(menu.getByRole('menuitemradio')).toHaveText(['L Low', 'M Medium', 'H High', 'Clear']);
    await expect(menu.getByRole('menuitemradio', { name: 'Low' })).toBeFocused();
    for (const item of await menu.getByRole('menuitemradio').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await axeOn(page);
    await page.screenshot({ path: `${shots}laptop-menu-open.png`, fullPage: true });
    await menu.getByRole('menuitemradio', { name: 'Medium' }).click();
    await expect(menu).toHaveCount(0);
    await expect(gl).toHaveAttribute('data-level', '2');
    await expect(gl).toBeFocused();

    // A short press still rates the next level.
    await gl.click();
    await expect(gl).toHaveAttribute('data-level', '3');

    // Escape closes the choices, changes nothing, and puts the keyboard back on the box.
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await expect(menu).toBeVisible();
    await page.mouse.up();
    await expect(menu.getByRole('menuitemradio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(gl).toBeFocused();
    await expect(gl).toHaveAttribute('data-level', '3');

    // The keyboard's equal: Enter opens the choices on the box's level; arrows and Enter pick; a cleared box offers Undo.
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitemradio', { name: 'High' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Clear' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(gl).toBeFocused();
    await expect(page.getByTestId('matrix-undo')).toContainText('Cleared.');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(gl).toHaveAttribute('data-level', '3');
    await expect(page.getByTestId('matrix-undo')).toHaveCount(0);

    // The menu key (Shift+F10) opens it too, and Tab leaves it: it is not a trap.
    await gl.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    // L, M, H set; Delete clears; Space takes the next level.
    await gl.focus();
    for (const [key, level] of [['l', '1'], ['m', '2'], ['h', '3'], ['Delete', '0'], ['Space', '1']]) {
      await page.keyboard.press(key);
      await expect(gl).toHaveAttribute('data-level', level);
    }

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

    // Clear all asks, then offers Undo for 8 seconds, and Undo puts every rating back.
    await page.keyboard.press('h');
    await expect(page.getByTestId('matrix-count')).toHaveText('2 of 65 rated');
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Yes, clear all' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('0 of 65 rated');
    await expect(page.getByTestId('matrix-undo')).toContainText('Cleared.');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('2 of 65 rated');
    await expect(gl).toHaveAttribute('data-level', '1');
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Yes, clear all' }).click();
    await expect(page.getByTestId('matrix-undo')).toBeVisible();
    await page.waitForTimeout(8300);
    await expect(page.getByTestId('matrix-undo')).toHaveCount(0);
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
    await expect(page.getByTestId('matrix-count')).toHaveText('10 of 65 rated');
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

  test('a tap shows its colour within 100 ms at a 4x slower processor (Chromium, measured and printed)', async ({ page, browserName }) => {
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
        await page.waitForTimeout(120);
      }
    }
    const taps = await page.evaluate(() => (window as unknown as { pmsTaps: number[] }).pmsTaps.slice().sort((a, b) => a - b));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const median = taps[Math.floor(taps.length / 2)];
    const worst = taps[taps.length - 1];
    console.log(`  tap to paint at 4x slowdown, ${taps.length} taps: median ${median.toFixed(1)} ms, slowest ${worst.toFixed(1)} ms`);
    expect(taps.length).toBe(12);
    expect(median).toBeLessThan(100);
  });

  test('the bubble, the strip, the notes and the stored answer (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    // The bubble points at the first empty box, and goes for this visit after the first rating.
    const teach = page.getByTestId('matrix-teach');
    await expect(teach).toHaveText('Tap to rate. Press and hold for choices.');
    const firstBox = box(page, 'Corp accounting – GL', 'Strategic value');
    await expect(firstBox).toHaveAttribute('aria-describedby', /teach/);
    await firstBox.click();
    await expect(box(page, 'Corp accounting – GL', 'Strategic value')).toHaveAttribute('data-level', '1');
    await expect(teach).toHaveCount(0);
    await page.getByRole('button', { name: 'One at a time' }).click();
    await page.getByRole('button', { name: 'All at once' }).click();
    await expect(teach).toHaveCount(0);

    // A tap: Low, Medium, High, then clear; each with its letter and its shape.
    const gl = box(page, 'Corp accounting – GL', 'Volume / repeatability');
    for (const [level, letter] of [['1', 'L'], ['2', 'M'], ['3', 'H']]) {
      await gl.click();
      await expect(gl).toHaveAttribute('data-level', level);
      await expect(gl).toHaveText(letter);
      await expect(gl.locator('svg path')).toHaveCount(1);
    }
    await gl.click();
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(page.getByTestId('matrix-count')).toHaveText('1 of 65 rated');
    await expect(page.getByTestId('matrix-pill-low')).toHaveText('Low 1');
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
    await page.getByRole('button', { name: 'Yes, clear all' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('0 of 65 rated');

    // Every box High through Next empty box, then Send: the answer Prompt 34 stored for the same ratings.
    for (let at = 0; at < 65; at += 1) {
      await page.getByRole('button', { name: /Next empty box/ }).click();
      await page.keyboard.press('h');
    }
    await expect(page.getByRole('button', { name: 'All rated' })).toBeDisabled();
    await page.screenshot({ path: `${shots}ipad-landscape-complete.png`, fullPage: true });
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    const [record] = saved(fake);
    const all = Object.fromEntries(OPTION_IDS.map((id) => [id, Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, 3]))]));
    expect(record.answer).toEqual(encodeAnswer(all));
  });
});
