import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newFake, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 10h, part C: Setup's buttons can be seen. On the real site (PCOE, 14 Oct 2026) the deployer pressed Create, Add an admin and Seed sample
// clients with the keyboard: the primary buttons were white words on no background, the others looked like plain text, and the page was in a serif
// face. setup-main.ts had never imported the token files admin-main.ts imports (tokens.css, fonts-admin.css, admin-tokens.css), so every rule of
// admin.css that reads a token read nothing. The other specs press buttons by their names, so none of them failed, and axe passes a button that is
// switched off (as the primary ones are when the page opens). This looks at every button the way a person does: each has an edge (a background that
// is not the page's, or a border), and each that can be pressed has words of 4.5:1 or better against what is really behind them. In all three engines.

const shots = fileURLToPath(new URL('../../test-results/setup/', import.meta.url));

type Seen = { name: string; enabled: boolean; edge: boolean; ratio: number; words: string; behind: string; face: string };

/** Every visible button on the page, measured: colours are painted on a canvas and read back, so any way of writing a colour is understood. */
const measure = (page: Page): Promise<Seen[]> => page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  /** A CSS colour as [r, g, b, a], a from 0 to 1. */
  const rgba = (value: string): number[] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: number[], below: number[]) => [0, 1, 2].map((index) => top[index] * top[3] + below[index] * (1 - top[3])).concat(1);
  /** What is painted behind an element: every background from the page down to it, laid one over the other on white. */
  const behind = (element: Element | null): number[] => {
    const chain: Element[] = [];
    for (let at = element; at; at = at.parentElement) chain.unshift(at);
    return chain.reduce((below, each) => over(rgba(getComputedStyle(each).backgroundColor), below), [255, 255, 255, 1]);
  };
  const luminance = ([r, g, b]: number[]) => {
    const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const same = (a: number[], b: number[]) => a.slice(0, 3).every((value, index) => Math.abs(value - b[index]) < 3);
  const show = (value: number[]) => `rgb(${value.slice(0, 3).map(Math.round).join(' ')})`;
  return [...document.querySelectorAll('button')].filter((button) => button.getClientRects().length > 0 && getComputedStyle(button).visibility !== 'hidden').map((button) => {
    const style = getComputedStyle(button);
    const page = behind(button.parentElement);
    const own = over(rgba(style.backgroundColor), page);
    const border = rgba(style.borderTopColor);
    const bordered = parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== 'none' && border[3] > 0 && !same(over(border, page), page);
    const filled = rgba(style.backgroundColor)[3] > 0 && !same(own, page);
    const words = over(rgba(style.color), own);
    return {
      name: (button.textContent ?? '').replace(/\s+/g, ' ').trim() || button.getAttribute('aria-label') || '(no name)',
      enabled: !button.disabled, edge: filled || bordered, ratio: Math.round(contrast(words, own) * 100) / 100,
      words: show(words), behind: show(own), face: style.fontFamily,
    };
  });
});

/** The buttons that cannot be seen as buttons, in words: an empty list when every one can. */
const unseen = (found: Seen[]) => found.flatMap((button) => [
  ...(button.edge ? [] : [`"${button.name}" has no edge: no background of its own and no border (words ${button.words} on ${button.behind})`]),
  ...(!button.enabled || button.ratio >= 4.5 ? [] : [`"${button.name}" has words of ${button.ratio}:1 against what is behind them (${button.words} on ${button.behind})`]),
]);

async function openSetup(page: Page, fake: Fake) {
  await serveSharePoint(page, fake);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pageUrl('setup.html'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });

test('every button on Setup can be seen, and every one that can be pressed reads at 4.5:1: a ready site, with an admin to add and a file to import', async ({ page }, info) => {
  await openSetup(page, newFake());
  await expect(page.getByTestId('lists-version')).toContainText('The lists are the version this app needs.');
  // (Seeding and the import are switched on by a clean Check Lists.)
  await page.getByRole('button', { name: 'Check Lists', exact: true }).click();
  await expect(page.getByTestId('lists-status')).toContainText('All list schemas ready.');
  await page.getByLabel('Name', { exact: true }).fill('Casey Example');
  await page.getByLabel('Private seed file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, data: { clients: [] } })) });
  for (const name of ['Add an admin', 'Seed sample clients', 'Import Missing Records', 'Check Lists', 'Run self-test']) {
    await expect(page.getByRole('button', { name, exact: true }), `${name} can be pressed here`).toBeEnabled();
  }
  const found = await measure(page);
  expect(found.length).toBeGreaterThanOrEqual(8);
  expect(unseen(found)).toEqual([]);
  expect(found.filter((button) => button.name === 'Add an admin' || button.name === 'Seed sample clients').every((button) => button.ratio >= 4.5)).toBe(true);
  expect(found[0].face, 'the page is in Open Sans, as the admin page is').toMatch(/^"?Open Sans"?/);
  await page.screenshot({ path: `${shots}look-ready-${info.project.name}.png`, fullPage: true });
});

test('Create can be seen once the plan has something to make', async ({ page }, info) => {
  await openSetup(page, newFake({ without: ['uservisitlogs'] }));
  await page.getByRole('button', { name: 'Show the plan', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Create/ })).toBeEnabled();
  const found = await measure(page);
  expect(found.some((button) => /^Create/.test(button.name) && button.enabled)).toBe(true);
  expect(unseen(found)).toEqual([]);
  await page.screenshot({ path: `${shots}look-plan-${info.project.name}.png`, fullPage: true });
});
