import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { open, settled, site, type Site } from './explain-support.js';

// Prompt 33, the full UI/UX review: every tab and sub-view of the admin page, on the sample data, at 1366 x 650, 1920 x 950 and 683 x 700, read
// against the whole-panel rules (docs/RULES.md, "The admin page explains itself"). It writes the list of problems it finds to
// test-results/admin/review/review.json and prints it (an empty list teaches when its section holds the button that fills it); the test fails on any problem not named in LEFT (what the report says was left, and why).

const out = fileURLToPath(new URL('../../test-results/admin/review/', import.meta.url));
const SIZES = [{ width: 1366, height: 650 }, { width: 1920, height: 950 }, { width: 683, height: 700 }] as const;
/** What the primary green of the main action paints (--adm-primary; the browser code at the line that checks it spells the same colour). */
const GREEN = 'rgb(47, 107, 79)'; // --adm-primary, #2F6B4F (Prompt 38; it was #237F0C)
/** Problems left on purpose, by the start of their words: each one is in the report with its reason. */
const LEFT: string[] = [];

type View = { name: string; hash: string; then?: (page: Page) => Promise<void> };
const VIEWS: View[] = [
  { name: 'Today', hash: 'today' },
  { name: 'Clients', hash: 'clients' },
  { name: 'Clients › Kroger', hash: 'clients', then: async (page) => { await page.locator('#sessions-c-kroger').click(); } },
  { name: 'Content › Activities', hash: 'content' },
  { name: 'Content › Brand', hash: 'content/brand' },
  { name: 'Guests and QR', hash: 'guests' },
  { name: 'Results', hash: 'results' },
  { name: 'People', hash: 'users' },
  { name: 'People › Mathur, Pulkit', hash: 'users', then: async (page) => { await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click(); } },
];

/** Reads the page against the rules; each problem is a sentence. Runs in the page. */
function readPage() {
  const problems: string[] = [];
  const shown = (el: Element) => { const box = (el as HTMLElement).getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const words = (el: Element) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
  const body = document.querySelector('.shell__body')!;
  const head = [...body.querySelectorAll('.panel__head')].find(shown);
  if (!head) problems.push('no title line');
  else {
    const title = head.querySelector('h2');
    if (!title?.querySelector('svg')) problems.push(`title "${words(title ?? head)}" has no icon`);
    if (!head.querySelector('p')) problems.push(`title "${words(title ?? head)}" has no sentence under it`);
    const mains = [...head.querySelectorAll('.btn--primary')].filter(shown);
    if (mains.length > 1) problems.push(`title line has ${mains.length} main actions: ${mains.map(words).join(', ')}`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
  for (const button of [...body.querySelectorAll('button, a.btn, [role="switch"], [role="tab"]')].filter(shown)) {
    const name = words(button) || button.getAttribute('title') || '';
    const box = button.getBoundingClientRect();
    if (!name) problems.push(`a button with no name (${button.className})`);
    if (/^(Save|OK|Submit)$/i.test(name)) problems.push(`a button only says "${name}"`);
    if (box.height < 43.5 || box.width < 43.5) problems.push(`"${name}" is ${Math.round(box.width)} x ${Math.round(box.height)} px, under 44`);
    if ((button as HTMLElement).scrollWidth > (button as HTMLElement).clientWidth + 1) problems.push(`"${name}" is clipped`);
    if (button.classList.contains('btn--primary') && getComputedStyle(button).backgroundColor !== 'rgb(47, 107, 79)') problems.push(`main action "${name}" is not the primary green`);
  }
  for (const foot of [...body.querySelectorAll('.dialog__actions, .form__foot')].filter(shown)) {
    const buttons = [...foot.querySelectorAll('button')].filter(shown);
    const main = buttons.findIndex((button) => button.classList.contains('btn--primary'));
    if (main !== -1 && main !== buttons.length - 1) problems.push(`footer "${buttons.map(words).join(' | ')}": main action is not last`);
    const right = foot.getBoundingClientRect().right;
    const last = buttons.at(-1)?.getBoundingClientRect().right ?? right;
    if (buttons.length && right - last > 2) problems.push(`footer "${buttons.map(words).join(' | ')}" is not right-aligned`);
  }
  for (const empty of [...body.querySelectorAll('p.muted')].filter(shown)) {
    const text = words(empty);
    if (/^No (one|sessions?|guests?|clients?|activities|visits|iPads)\b/.test(text) && !empty.closest('section')?.querySelector('button.btn--primary, .part__head button')) {
      problems.push(`empty state "${text.slice(0, 60)}" has no next step`);
    }
  }
  // Labels above inputs share a left edge within a form.
  for (const form of [...body.querySelectorAll('form')].filter(shown)) {
    const lefts = [...new Set([...form.querySelectorAll('.field__label')].filter(shown).map((label) => Math.round(label.getBoundingClientRect().left)))];
    const columns = new Set([...form.querySelectorAll('.field')].filter(shown).map((field) => Math.round(field.getBoundingClientRect().left)));
    if (lefts.length > columns.size) problems.push(`a form's labels start at ${lefts.length} left edges`);
  }
  return [...new Set(problems)];
}

test('the review: every tab at three sizes, against the whole-panel rules', async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(out, { recursive: true });
  const found: Record<string, string[]> = {};
  let built: Site | null = null;
  for (const size of SIZES) {
    for (const view of VIEWS) {
      built = await site();
      await page.setViewportSize(size);
      await open(page, built, view.hash);
      await settled(page);
      if (view.then) { await view.then(page); await settled(page); }
      const at = `${view.name} at ${size.width} x ${size.height}`;
      const problems = (await page.evaluate(readPage)).filter((problem) => !LEFT.some((left) => problem.startsWith(left)));
      if (problems.length) found[at] = problems;
      await page.screenshot({ path: `${out}${view.name.replace(/[^a-z0-9]+/gi, '-')}-${size.width}x${size.height}.png`, fullPage: true });
    }
  }
  await writeFile(`${out}review.json`, JSON.stringify(found, null, 2));
  console.log(JSON.stringify(found, null, 2));
  expect(found, 'the review found these problems').toEqual({});
});

export { GREEN };
