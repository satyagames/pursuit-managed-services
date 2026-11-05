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

  test('the bubble, the strip, the notes and the stored answer (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    // The bubble points at the first empty box, and goes for this visit after the first rating.
    const teach = page.getByTestId('matrix-teach');
    await expect(teach).toHaveText('Tap to rate.');
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
