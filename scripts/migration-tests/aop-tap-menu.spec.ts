import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { DEFAULT_CRITERIA } from '../../migration/src/lib/admin/aop-editor.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Prompt 42: the Art of Possibility's participant polish, in the BUILT participant page against the mocked SharePoint REST, with the manager's sample (13
// sub-processes by the five default criteria) at an iPad in landscape and in portrait, a 1366 x 650 laptop and a 390 px phone. Wider card margins; one tap
// opens a Low / Medium / High (/ Clear) menu on the box and nothing else rates it (no press and hold, no tap-to-cycle); headings in two lines of whole
// words; a legend of colour and word beside the view switch; no counts, "rated" or Undo outside the summary; no grid icon in the summary or on the hub.

const shots = fileURLToPath(new URL('../../test-results/aop-tap-menu/', import.meta.url));
const today = localDate();
const SIZES = {
  'ipad-landscape': { width: 1180, height: 820 },
  'ipad-portrait': { width: 820, height: 1180 },
  laptop: { width: 1366, height: 650 },
  phone: { width: 390, height: 844 },
} as const;
type Size = (typeof SIZES)[keyof typeof SIZES];
const ROWS: [string, number][] = [['Corp accounting – GL', 29], ['AP / AR', 28], ['Other finance', 11], ['Treasury', 8], ['Tax', 7], ['FP&A', 6], ['Payroll', 5], ['Fixed assets', 4], ['Intercompany', 4], ['Internal audit', 4], ['Regional finance', 4], ['Procurement admin', 3], ['National admin', 0]];
const OPTION_IDS = ROWS.map((_, at) => `o-${at + 1}`);
/** A made-up label of 40 characters, the longest a heading is tested with. */
const LONG = 'Regulatory exposure and data sensitivity';

async function site({ labels }: { labels?: string[] } = {}) {
  const criteria = DEFAULT_CRITERIA.map((criterion, at) => ({ ...criterion, label: labels?.[at] ?? criterion.label, id: `c-${String(at + 1).repeat(6)}` }));
  const fake = newFake();
  const tokens: string[] = [];
  await onSite(fake, async (ds) => {
    await ds.createClient({ id: 'c-kroger', name: 'Kroger', slug: 'kroger', status: 'active', themeVersion: 1, theme: null, logoUrl: null, primaryColor: null, secondaryColor: null, createdAt: new Date().toISOString() });
    for (const [at, [label, people]] of ROWS.entries()) await ds.createOption({ id: OPTION_IDS[at], questionId: 'q-aop', ...ds.matrixRowFields({ label, people: String(people) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds: OPTION_IDS, order: 1, criteria });
    await ds.createSection({ id: 'sec-aop', title: 'The Art of Possibility', order: 1, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-kroger' });
    const { session } = await ds.activateClient('c-kroger', today) as { session: { id: string } };
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const visitor = await ds.createVisitor({ id: 'v-1', sessionId: session.id, displayName: 'Priya Rao', enabled: true, guestGroup: '' }) as { id: string };
    tokens.push((await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id }) as { id: string }).id);
  });
  return { fake, token: tokens[0], criteria };
}

async function open(page: Page, fake: Fake, token: string, size: Size, { grid = false, query = '' } = {}) {
  await page.setViewportSize(size);
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}?qr=${token}${query}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /The Art of Possibility/ }).click();
  await expect(page.getByTestId('matrix')).toBeVisible();
  if (grid) await page.getByRole('button', { name: 'All at once' }).click();
  await page.getByTestId('matrix').evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((each) => each.finished)));
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const box = (page: Page, row: string, criterion: string) => page.getByRole('button', { name: new RegExp(`^${escapeRe(row)}, ${escapeRe(criterion)}: `) });
const menuOf = (page: Page) => page.getByRole('menu');
const axeOn = async (page: Page) => expect((await new AxeBuilder({ page }).include('[data-testid="matrix"]').analyze()).violations.map((each) => `${each.id}: ${each.nodes[0]?.target}`)).toEqual([]);
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const progress = (page: Page) => page.getByRole('progressbar', { name: 'Your progress' });
/** The menu's choices, by their accessible names (the chips' letters are hidden from them). */
async function expectChoices(menu: Locator, names: string[]) {
  const items = menu.getByRole('menuitemradio');
  await expect(items).toHaveCount(names.length);
  for (const [at, name] of names.entries()) await expect(items.nth(at)).toHaveAccessibleName(name);
}

/** Every element that scrolls vertically, other than the page itself. */
const innerVerticalScrollers = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter((node) => {
  const style = getComputedStyle(node);
  return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
}).map((node) => node.className || node.tagName));

/** Each criterion heading: how many lines its name takes, and whether a word is split across lines or runs out of its cell. */
const headingLines = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.matrix-head-words')].map((words) => {
  const text = words.firstChild as Text;
  const cell = words.closest('th')!.getBoundingClientRect();
  const lines = new Set<number>();
  const broken: string[] = [];
  for (const match of (text.data ?? '').matchAll(/\S+/g)) {
    const range = document.createRange();
    range.setStart(text, match.index!);
    range.setEnd(text, match.index! + match[0].length);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    if (rects.length !== 1) broken.push(`"${match[0]}" on ${rects.length} lines`);
    else if (rects[0].right > cell.right + 0.5 || rects[0].left < cell.left - 0.5) broken.push(`"${match[0]}" runs out of its heading`);
    for (const rect of rects) lines.add(Math.round(rect.top));
  }
  return { text: text.data, rendered: words.innerText.replace(/\s+/g, ' ').trim(), lines: lines.size, broken, ellipsis: getComputedStyle(words).textOverflow === 'ellipsis' };
}));

async function expectHeadingsInTwoLines(page: Page) {
  for (const head of await headingLines(page)) {
    expect(head.broken, head.text).toEqual([]);
    expect(head.lines, `${head.text}: ${head.lines} lines`).toBeLessThanOrEqual(2);
    expect(head.rendered, 'the words shown are the label\'s words').toBe(head.text.replace(/\s+/g, ' ').trim());
    expect(head.ellipsis).toBe(false);
  }
}

/** The card's padding on each side, and whether any of its content reaches into that padding. */
const cardEdges = (page: Page) => page.getByTestId('matrix').evaluate((card) => {
  const style = getComputedStyle(card);
  const pad = ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(style[`padding${side}` as 'paddingTop']));
  const frame = card.getBoundingClientRect();
  const inner = { top: frame.top + pad[0], right: frame.right - pad[1], bottom: frame.bottom - pad[2], left: frame.left + pad[3] };
  const outside: string[] = [];
  const scroller = card.querySelector<HTMLElement>('.matrix-well[data-cramped], .matrix-well[data-fit="3"]');
  for (const node of card.querySelectorAll<HTMLElement>('*')) {
    if (node.closest('.sr-only') || getComputedStyle(node).position === 'absolute' || getComputedStyle(node).position === 'fixed') continue;
    if (scroller && scroller.contains(node) && node !== scroller) continue; // (inside a grid that scrolls in its card: the box is what is held)
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.left < inner.left - 0.5 || rect.right > inner.right + 0.5 || rect.top < inner.top - 0.5 || rect.bottom > inner.bottom + 0.5) outside.push(`${node.tagName}.${node.className}`);
  }
  return { pad, outside: outside.slice(0, 5) };
});

test.describe('the Art of Possibility, participant polish (Prompt 42)', () => {
  for (const [name, size] of Object.entries(SIZES)) {
    test(`${name} (${size.width} x ${size.height}): the card's margins, one scroll, 48 px boxes, the legend beside the switch, nothing "rated" and no Undo`, async ({ page }) => {
      const { fake, token } = await site();
      await open(page, fake, token, size);
      const phone = size.width < 600;
      const floor = phone ? 20 : 32;
      for (const view of ['default', 'grid'] as const) {
        if (view === 'grid') await page.getByRole('button', { name: 'All at once' }).click();
        // The card's padding, on all four sides, and nothing inside touches it.
        const edges = await cardEdges(page);
        for (const side of edges.pad) expect(side).toBeGreaterThanOrEqual(floor);
        expect(edges.outside, `${view}: inside the card's padding`).toEqual([]);
        expect(await noSidewaysScroll(page), `${view}: no sideways scroll`).toBe(true);
        expect(await innerVerticalScrollers(page), `${view}: one vertical scrollbar, the page's`).toEqual([]);
        await page.screenshot({ path: `${shots}${name}-${view}.png`, fullPage: true });
      }
      // (In the grid now.) Boxes stay 48 px; the first row's name starts at the line of the instructions.
      const first = (await box(page, 'Corp accounting – GL', 'Strategic value').boundingBox())!;
      expect(first.width).toBeGreaterThanOrEqual(48);
      expect(first.height).toBeGreaterThanOrEqual(48);
      const nameX = await page.getByRole('rowheader', { name: /Corp accounting/ }).locator('.matrix-row-name').evaluate((node) => node.getBoundingClientRect().left);
      const howX = await page.locator('.matrix-how').evaluate((node) => node.getBoundingClientRect().left);
      expect(Math.abs(nameX - howX)).toBeLessThan(1);
      const cardLeft = await page.getByTestId('matrix').evaluate((node) => node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft));
      expect(nameX - cardLeft).toBeGreaterThanOrEqual(8 - 0.5);
      await expectHeadingsInTwoLines(page);

      // The legend: three swatches and their words, no figure, no shape, no letter; aligned with the view switch.
      const legend = page.getByTestId('matrix-legend');
      await expect(legend.getByRole('listitem')).toHaveText(['Low', 'Medium', 'High']);
      await expect(legend.locator('.matrix-swatch')).toHaveCount(3);
      await expect(legend.locator('svg')).toHaveCount(0);
      expect(await legend.innerText()).not.toMatch(/\d/);
      for (const swatch of await legend.locator('.matrix-swatch').all()) {
        const at = (await swatch.boundingBox())!;
        expect([Math.round(at.width), Math.round(at.height)]).toEqual([14, 14]);
      }
      const legendAt = (await legend.boundingBox())!;
      const switchAt = (await page.getByTestId('matrix-views').boundingBox())!;
      if (size.width >= 1024) {
        // Side by side: one height, one line, the legend left of the switch.
        expect(Math.abs(legendAt.height - switchAt.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(legendAt.y - switchAt.y)).toBeLessThanOrEqual(1);
        expect(legendAt.x + legendAt.width).toBeLessThanOrEqual(switchAt.x);
      } else {
        // Under the switch, right-aligned to its edge.
        expect(Math.abs(legendAt.x + legendAt.width - (switchAt.x + switchAt.width))).toBeLessThanOrEqual(1);
        expect(legendAt.y).toBeGreaterThanOrEqual(switchAt.y + switchAt.height - 1);
      }
      await expect(page.locator('.matrix-caption')).toHaveText('Colour shows the rating, not good or bad.');

      // No count, no "rated" and no Undo on the question (the summary, once every box is rated, has its own words); the progress is spoken only.
      const words = await page.getByTestId('matrix').innerText();
      expect(words).not.toMatch(/\brated\b/i);
      expect(words).not.toMatch(/\bUndo\b/);
      await expect(page.getByTestId('matrix-count')).toHaveCount(0);
      await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
      await expect(progress(page)).toHaveAttribute('aria-valuetext', '0 of 65 boxes');
      // No press-and-hold words anywhere, in either view.
      await expect(page.getByText(/hold/i)).toHaveCount(0);
      await expect(page.getByText('Tap a box and choose Low, Medium or High.')).toBeVisible();
      await expect(page.getByTestId('matrix-teach')).toHaveText('Tap to rate');
      await page.getByRole('button', { name: 'One at a time' }).click();
      await expect(page.getByText(/hold/i)).toHaveCount(0);
    });

    test(`${name}: one tap opens Low, Medium, High (and Clear once rated) on the box, inside the card and the screen; a choice rates it and closes the menu`, async ({ page }) => {
      const { fake, token } = await site();
      await open(page, fake, token, size, { grid: true });
      const menu = menuOf(page);
      const corners = [['Corp accounting – GL', 'Strategic value'], ['Tax', 'Standardisation'], ['Corp accounting – GL', 'Outsourcing suitability'], ['National admin', 'Outsourcing suitability'], ['National admin', 'Strategic value']] as const;
      for (const [row, criterion] of corners) {
        const target = box(page, row, criterion);
        await target.scrollIntoViewIfNeeded();
        await expect(target).toHaveAttribute('aria-expanded', 'false');
        await target.click();
        await expect(menu).toBeVisible();
        await expect(target).toHaveAttribute('aria-expanded', 'true');
        await expect(target).toHaveAttribute('data-level', '0'); // a tap alone never rates
        await expectChoices(menu, ['Low', 'Medium', 'High']);
        await expectMenuPlaced(page, menu, target, size);
        await menu.getByRole('menuitemradio', { name: 'High' }).click();
        await expect(menu).toHaveCount(0);
        await expect(target).toHaveAttribute('data-level', '3');
        await expect(target).toHaveText('H');
        await expect(target).toBeFocused();
        // Rated: Clear is offered, the chosen level has a check and a darker outline.
        await target.click();
        await expectChoices(menu, ['Low', 'Medium', 'High', 'Clear']);
        const high = menu.getByRole('menuitemradio', { name: 'High' });
        await expect(high).toHaveAttribute('aria-checked', 'true');
        await expect(high.locator('.matrix-chosen')).toHaveCount(1);
        expect(await high.evaluate((node) => getComputedStyle(node).boxShadow)).toMatch(/inset/);
        await expectMenuPlaced(page, menu, target, size);
        await page.screenshot({ path: `${shots}${name}-menu-${row.replace(/\W+/g, '-')}-${criterion.replace(/\W+/g, '-')}.png` });
        await menu.getByRole('menuitemradio', { name: 'Clear' }).click();
        await expect(target).toHaveAttribute('data-level', '0');
      }
      await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
    });
  }

  test('the touch screen: a tap opens the menu and a tap on a choice rates; a press held 700 ms does the same as a tap; the box never rates on its own (iPad landscape)', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: SIZES['ipad-landscape'] });
    const page = await context.newPage();
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    const menu = menuOf(page);
    await gl.tap();
    await expect(menu).toBeVisible();
    await expect(gl).toHaveAttribute('data-level', '0');
    await menu.getByRole('menuitemradio', { name: 'Medium' }).tap();
    await expect(menu).toHaveCount(0);
    await expect(gl).toHaveAttribute('data-level', '2');
    // Twenty taps: never a change of rating without a choice.
    for (let at = 0; at < 20; at += 1) await gl.tap();
    await expect(gl).toHaveAttribute('data-level', '2');
    await expect(menu).toHaveCount(0); // (an even number of taps: open, closed)
    // A long press (700 ms) with the mouse is a tap: the menu opens and nothing is rated.
    const at = (await gl.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(menu).toBeVisible();
    await expect(gl).toHaveAttribute('data-level', '2');
    await expect(page.locator('[data-holding]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The same press on an empty box.
    const ap = box(page, 'AP / AR', 'Strategic value');
    const apAt = (await ap.boundingBox())!;
    await page.mouse.move(apAt.x + apAt.width / 2, apAt.y + apAt.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await expect(menu).toHaveCount(0); // nothing opens while it is held
    await page.mouse.up();
    await expect(menu).toBeVisible();
    await expect(ap).toHaveAttribute('data-level', '0');
    await context.close();
  });

  test('the menu closes on a second tap, a tap outside, Escape and a scroll of more than 24 px, with focus back on its box; one menu at a time (laptop)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES.laptop);
    const menu = menuOf(page);
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    const ap = box(page, 'AP / AR', 'Volume / repeatability');
    await gl.click();
    await expect(menu).toHaveCount(1);
    await gl.click();
    await expect(menu).toHaveCount(0);
    await expect(gl).toBeFocused();
    await gl.click();
    await ap.click();
    await expect(menu).toHaveCount(1);
    await expect(ap).toHaveAttribute('aria-expanded', 'true');
    await expect(gl).toHaveAttribute('aria-expanded', 'false');
    await page.getByText('Tap a box and choose Low, Medium or High.').click();
    await expect(menu).toHaveCount(0);
    await expect(ap).toBeFocused();
    await ap.click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(ap).toBeFocused();
    // A small scroll keeps it; more than 24 px closes it.
    await ap.click();
    const y = await page.evaluate(() => window.scrollY);
    await page.evaluate((from) => window.scrollTo(0, from + 20), y);
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(1);
    await page.evaluate((from) => window.scrollTo(0, from + 60), y);
    await expect(menu).toHaveCount(0);
    await expect(ap).toBeFocused();
    await expect(ap).toHaveAttribute('data-level', '0');
    await expect(gl).toHaveAttribute('data-level', '0');
  });

  test('the keyboard and a screen reader: Enter, Space and Down open the menu, arrows move, L, M and H set, Delete clears, Escape closes and returns focus; axe passes with the menu open (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    const menu = menuOf(page);
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    await expect(gl).toHaveAttribute('aria-haspopup', 'menu');
    await expect(gl).toHaveAttribute('aria-expanded', 'false');
    // The shortcuts are announced with every box.
    await expect(gl).toHaveAccessibleDescription(/Enter opens the choices; L, M or H rates; Delete clears\./);
    await gl.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Low' })).toBeFocused();
    await axeOn(page);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Medium' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Low' })).toBeFocused(); // round again
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitemradio', { name: 'High' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(gl).toHaveAttribute('data-level', '3');
    await expect(gl).toBeFocused();
    // Space and Down open it too, on the box's own level; Escape closes it and changes nothing.
    for (const key of ['Space', 'ArrowDown']) {
      await page.keyboard.press(key);
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitemradio', { name: 'High' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(gl).toBeFocused();
      await expect(gl).toHaveAttribute('data-level', '3');
    }
    // L, M, H set without opening; Delete clears; inside the menu the letters choose.
    for (const [key, level] of [['l', '1'], ['m', '2'], ['h', '3'], ['Delete', '0'], ['m', '2'], ['Backspace', '0']]) {
      await page.keyboard.press(key);
      await expect(gl).toHaveAttribute('data-level', level);
      await expect(menu).toHaveCount(0);
    }
    await page.keyboard.press('Enter');
    await page.keyboard.press('l');
    await expect(gl).toHaveAttribute('data-level', '1');
    await expect(gl).toBeFocused();
    // Arrows move between boxes; Tab leaves the menu (never a trap).
    await page.keyboard.press('ArrowRight');
    await expect(box(page, 'Corp accounting – GL', 'Volume / repeatability')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(box(page, 'AP / AR', 'Volume / repeatability')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(box(page, 'Corp accounting – GL', 'Volume / repeatability')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(gl).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
  });

  test('every heading is two lines of whole words at most, the qualifier in brackets in the note and the name, with the sample and a 40-character label', async ({ browser }) => {
    test.setTimeout(120_000);
    expect(LONG.length).toBe(40);
    for (const labels of [undefined, [LONG, 'Volume / repeatability', 'Standardisation', 'Compliance / risk (counts against)', 'Outsourcing suitability (counts against)']]) {
      for (const [name, size] of Object.entries(SIZES)) {
        const { fake, token, criteria } = await site({ labels });
        const context = await browser.newContext();
        const page = await context.newPage();
        await open(page, fake, token, size, { grid: true });
        await expectHeadingsInTwoLines(page);
        // The heading cells are one height, and every note's button sits on one line.
        const heads = await page.locator('.matrix-head').evaluateAll((cells) => cells.map((cell) => ({ height: cell.getBoundingClientRect().height, info: cell.querySelector('.matrix-info')?.getBoundingClientRect().top ?? null })));
        expect(new Set(heads.map((each) => Math.round(each.height))).size).toBe(1);
        expect(new Set(heads.map((each) => Math.round(each.info ?? -1))).size, 'the buttons are on one line').toBe(1);
        // The criteria columns are one width, at least 112 px.
        const widths = await page.locator('.matrix-head').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
        expect(Math.min(...widths)).toBeGreaterThanOrEqual(112);
        if (labels) {
          await page.screenshot({ path: `${shots}${name}-long-headings.png` });
          const heading = page.getByRole('columnheader', { name: 'Compliance / risk (counts against)' });
          await expect(heading).toBeVisible();
          await expect(heading.locator('.matrix-head-words')).toHaveText('Compliance / risk');
          await heading.getByRole('button', { name: 'About Compliance / risk' }).click();
          await expect(page.getByTestId('matrix-about')).toContainText('Compliance / risk (counts against)');
          await expect(page.getByTestId('matrix-about')).toContainText(criteria[3].hint);
          await page.keyboard.press('Escape');
        }
        await context.close();
      }
    }
  });

  test('the counts are in the summary only, which has no grid icon; Clear all asks first; the hub\'s pill has no grid icon and keeps its state (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    for (let at = 0; at < 65; at += 1) {
      await page.getByRole('button', { name: /Next empty box/ }).click();
      await page.keyboard.press(['l', 'm', 'h', 'h', 'm'][at % 5]);
    }
    const glance = page.getByTestId('matrix-glance');
    await expect(glance.getByRole('heading', { name: 'You rated all 65 boxes' })).toBeVisible();
    await expect(glance.getByTestId('matrix-tally')).toHaveText(['Low 13', 'Medium 26', 'High 26']);
    await expect(glance.locator('[data-testid="rating-mosaic"], [role="img"]')).toHaveCount(0);
    await expect(glance.locator('svg')).toHaveCount(3); // (the three chips' shapes only)
    expect(await glance.evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThanOrEqual(32);
    // Digits on the question outside the summary: only the People column and the strip's "left" (none now).
    const legendDigits = await page.getByTestId('matrix-key').innerText();
    expect(legendDigits).not.toMatch(/\d/);
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '65');
    await page.screenshot({ path: `${shots}ipad-landscape-summary.png`, fullPage: true });

    // Clear all: asked first, in plain words; Cancel keeps everything.
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Remove all your ratings?')).toBeVisible();
    await page.screenshot({ path: `${shots}ipad-landscape-clear-all.png` });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '65');

    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back to activities' }).click();
    const pill = page.getByRole('button', { name: /The Art of Possibility, done/ });
    await expect(pill).toBeVisible();
    await expect(page.locator('[data-testid="rating-mosaic"], .pms-mosaic')).toHaveCount(0);
    await expect(pill.locator('.badge svg')).toHaveCount(1); // its state icon stays
    await expect(pill).toContainText('Done');
    await page.waitForTimeout(2500); // (the hub's stamp moment settles)
    await page.screenshot({ path: `${shots}hub.png`, fullPage: true });
  });

  test('the menu is there in the frame after the tap, and a choice paints within 100 ms at a 4x slower processor (Chromium, measured and printed)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the processor slowdown is Chromium\'s (DevTools protocol)');
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      const scope = window as unknown as { pmsOpen: number[]; pmsPaint: number[] };
      scope.pmsOpen = [];
      scope.pmsPaint = [];
      let pressed = 0;
      let menuFrom = 0;
      document.addEventListener('pointerdown', () => { pressed = performance.now(); }, true);
      document.addEventListener('click', (event) => {
        if ((event.target as Element).closest('[data-cell]')) menuFrom = pressed;
      }, true);
      const root = document.querySelector('[data-testid="matrix"]')!;
      new MutationObserver((changes) => {
        if (menuFrom && changes.some((change) => [...change.addedNodes].some((node) => node instanceof Element && node.matches('[data-menu]')))) {
          const from = menuFrom;
          menuFrom = 0;
          requestAnimationFrame(() => scope.pmsOpen.push(performance.now() - from));
        }
      }).observe(root, { subtree: true, childList: true });
      new MutationObserver(() => {
        const from = pressed;
        if (!from) return;
        pressed = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => scope.pmsPaint.push(performance.now() - from)));
      }).observe(root, { subtree: true, attributeFilter: ['data-level'] });
    });
    for (const row of ROWS.slice(0, 4)) {
      for (const criterion of DEFAULT_CRITERIA.slice(0, 3)) {
        await box(page, row[0], criterion.label).click();
        await menuOf(page).getByRole('menuitemradio', { name: 'Medium' }).click();
        await page.waitForTimeout(120);
      }
    }
    const { opened, painted } = await page.evaluate(() => { const scope = window as unknown as { pmsOpen: number[]; pmsPaint: number[] }; return { opened: scope.pmsOpen, painted: scope.pmsPaint }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    console.log(`  at 4x slowdown, 12 boxes: the menu painted ${median(opened).toFixed(1)} ms after the press (median), a choice ${median(painted).toFixed(1)} ms`);
    expect(opened.length).toBe(12);
    expect(painted.length).toBe(12);
    expect(median(painted)).toBeLessThan(100);
    // The menu's fade is 120 ms at most, and nothing at all at the reduced level or with motion off.
    const fade = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[data-cell="5-0"]')!.click();
      await new Promise((done) => requestAnimationFrame(done));
      return document.querySelector('[data-menu]')!.getAnimations().map((each) => (each.effect?.getTiming().duration as number) ?? 0);
    });
    expect(fade.every((ms) => ms <= 120)).toBe(true);
  });

  test('with motion off the menu simply appears', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape'], { query: '&motion=off' });
    await box(page, 'Tax', 'Standardisation').click();
    await expect(menuOf(page)).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

/** The menu is attached to its box with a 6 px gap (below, or above), never covers it, and is inside the card and the screen; each choice 48 x 120 px or more. */
async function expectMenuPlaced(page: Page, menu: Locator, target: Locator, size: Size) {
  const at = (await target.boundingBox())!;
  const placed = (await menu.boundingBox())!;
  const card = (await page.getByTestId('matrix').boundingBox())!;
  const below = placed.y >= at.y + at.height;
  if (below) expect(Math.abs(placed.y - (at.y + at.height) - 6)).toBeLessThanOrEqual(1);
  else expect(Math.abs(at.y - (placed.y + placed.height) - 6)).toBeLessThanOrEqual(1);
  expect(placed.x).toBeGreaterThanOrEqual(Math.max(0, card.x) - 0.5);
  expect(placed.x + placed.width).toBeLessThanOrEqual(Math.min(size.width, card.x + card.width) + 0.5);
  expect(placed.y).toBeGreaterThanOrEqual(Math.max(0, card.y) - 0.5);
  expect(placed.y + placed.height).toBeLessThanOrEqual(Math.min(size.height, card.y + card.height) + 0.5);
  // Lined up with the box: from its left edge, or from its right edge near the end.
  const fromLeft = Math.abs(placed.x - at.x) <= 1;
  const fromRight = Math.abs(placed.x + placed.width - (at.x + at.width)) <= 1;
  expect(fromLeft || fromRight).toBe(true);
  for (const item of await menu.getByRole('menuitemradio').all()) {
    const each = (await item.boundingBox())!;
    expect(each.height).toBeGreaterThanOrEqual(48);
    expect(each.width).toBeGreaterThanOrEqual(120);
    const word = (await item.innerText()).trim();
    // Each level has its colour, its shape and its letter, so it reads without colour; Clear's chip is the dashed empty box.
    if (word !== 'Clear') await expect(item.locator('.matrix-chip svg path')).toHaveCount(1);
    if (word !== 'Clear') await expect(item.locator('.matrix-chip-letter')).toHaveText(word[0]);
  }
}
