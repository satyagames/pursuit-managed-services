import { expect, test, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { axeCheck, describeFindings } from './a11y-support.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 16, Part 3, in the BUILT admin page against the mocked SharePoint REST: in Content, Edit opens the question's editor inside its own row,
// under its text, not below the whole list; Add question opens one in a new row at the end. One at a time; focus goes to the Question field and back
// to Edit; a switch with unsaved changes asks once; Escape closes; Save and Cancel stay in reach in a tall editor. How a question is SAVED is
// unchanged (admin-content.spec.ts, test-admin-content.js).

const PIN = '2468';
const SECTION = 'sec-trivia';
const MANY = 12;

/** Kroger's trivia activity with twelve questions of its own (a long list), the tenth with eight picture tiles. */
async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    const ids: string[] = [];
    for (let index = 1; index <= MANY; index += 1) {
      const tiles = index === 10;
      const question = await ds.createQuestion({ id: `q-many-${index}`, sectionId: SECTION, type: 'single-select', prompt: `Question number ${index}`, optionIds: [], order: index, ...(tiles ? { layout: 'image-grid' } : {}) }) as { id: string };
      const options: string[] = [];
      for (let at = 1; at <= (tiles ? 8 : 2); at += 1) {
        const option = await ds.createOption({ id: `o-many-${index}-${at}`, questionId: question.id, label: `Answer ${index}.${at}`, value: `a${at}`, correct: null, ...(tiles ? { imageUrl: `https://img.test/${index}-${at}.png` } : {}) }) as { id: string };
        options.push(option.id);
      }
      await ds.updateQuestion(question.id, { optionIds: options });
      ids.push(question.id);
    }
    await ds.updateSection(SECTION, { questionIds: ids });
  });
  return fake;
}

async function openContent(page: Page, fake: Fake) {
  await page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#0B648F"/></svg>' }));
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#content`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  await page.locator(`[data-activity="${SECTION}"] .activity__select`).click();
  await expect(rowOf(page, MANY)).toBeVisible();
}
const rowOf = (page: Page, index: number) => page.locator(`.questions li[data-question="q-many-${index}"]`);
const editOf = (page: Page, index: number) => rowOf(page, index).getByRole('button', { name: 'Edit', exact: true });
const editors = (page: Page) => page.locator('.questions .content-editor');
const question = (page: Page) => page.getByLabel('Question', { exact: true });
/** Is the element fully inside the window? */
const inView = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => {
  const box = element.getBoundingClientRect();
  return box.top >= 0 && box.bottom <= window.innerHeight + 1;
});

test('Edit opens the editor inside the row it edits, in view, with focus on the Question field; Cancel gives focus back to Edit (Phase 16)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const fake = await site();
  await openContent(page, fake);
  // (The tenth of twelve: below the fold of a laptop screen, and the tallest editor, with eight picture tiles.)
  await editOf(page, 10).click();
  await expect(editors(page)).toHaveCount(1);
  // A child of the clicked row's list item, directly after the row's own controls.
  const placed = await rowOf(page, 10).evaluate((item) => {
    const editor = item.querySelector('.content-editor');
    const edit = [...item.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Edit');
    return { inside: Boolean(editor) && editor!.parentElement === item, after: Boolean(edit && editor && (edit.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING)), last: item.lastElementChild === editor };
  });
  expect(placed).toEqual({ inside: true, after: true, last: true });
  await expect(editOf(page, 10)).toHaveAttribute('aria-expanded', 'true');
  await expect(editOf(page, 10)).toHaveAttribute('aria-controls', 'question-editor-q-many-10');
  await expect(editOf(page, 9)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: /Edit question Question number 10/ })).toBeVisible();
  await expect(question(page)).toBeFocused();
  await expect(question(page)).toHaveValue('Question number 10');
  await expect.poll(() => inView(page, '.questions .content-editor textarea'), { message: 'the Question field is in view, with no scrolling by the person' }).toBe(true);
  // The row's own text stays above it, and the other rows where they were.
  await expect(rowOf(page, 10).locator('.row__title')).toHaveText('Question number 10');
  await expect(page.locator('.questions li[data-question] > .row__main .row__title')).toHaveCount(MANY);
  await expect(rowOf(page, 10).getByRole('button', { name: 'Delete', exact: true }), 'the row being edited cannot be deleted').toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(editors(page)).toHaveCount(0);
  await expect(editOf(page, 10)).toBeFocused();
  await expect(editOf(page, 10)).toHaveAttribute('aria-expanded', 'false');
});

test('Save keeps the change, closes the editor and puts focus back on its Edit; the page does not move when the editor is already in view (Phase 16)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const fake = await site();
  await openContent(page, fake);
  await rowOf(page, 1).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await editOf(page, 1).click();
  await expect(question(page)).toBeFocused();
  // (Within 2 px: WebKit rounds a scroll position to the device pixel.)
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before), 'nothing moved: the editor was in view').toBeLessThanOrEqual(2);
  await question(page).fill('Question number 1, revised');
  await expect(page.getByTestId('question-status')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(editors(page)).toHaveCount(0);
  await expect(rowOf(page, 1).locator('.row__title')).toHaveText('Question number 1, revised');
  await expect(editOf(page, 1)).toBeFocused();
  expect(fake.item('questions', 'q-many-1')!.Prompt).toBe('Question number 1, revised');
});

test('one editor at a time: a clean one switches at once, one with changes asks once (keep editing, or discard) (Phase 16)', async ({ page }) => {
  const fake = await site();
  await openContent(page, fake);
  await editOf(page, 2).click();
  await editOf(page, 3).click();
  await expect(editors(page)).toHaveCount(1);
  await expect(question(page)).toHaveValue('Question number 3');
  await question(page).fill('Typed and not saved');
  await editOf(page, 4).click();
  const ask = page.getByRole('dialog', { name: 'Discard your changes to this question?' });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(question(page)).toHaveValue('Typed and not saved');
  await expect(question(page)).toBeFocused();
  await editOf(page, 4).click();
  await ask.getByRole('button', { name: 'Discard changes' }).click();
  await expect(question(page)).toHaveValue('Question number 4');
  expect(fake.item('questions', 'q-many-3')!.Prompt, 'nothing was saved').toBe('Question number 3');
  // Edit on the open row again closes it.
  await editOf(page, 4).click();
  await expect(editors(page)).toHaveCount(0);
});

test('Escape closes a clean editor, and asks about one with changes; Add question opens a new row at the end (Phase 16)', async ({ page }) => {
  const fake = await site();
  await openContent(page, fake);
  await editOf(page, 5).click();
  await page.keyboard.press('Escape');
  await expect(editors(page)).toHaveCount(0);
  await expect(editOf(page, 5)).toBeFocused();
  await editOf(page, 5).click();
  await question(page).fill('Changed');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Discard your changes to this question?' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editors(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add question' }).click();
  const slot = page.locator('.questions li[data-question="new"]');
  await expect(slot).toBeVisible();
  expect(await page.locator('.questions ul.rows > li').last().getAttribute('data-question'), 'at the end of the list, where the question will appear').toBe('new');
  await expect(slot.getByRole('heading', { name: 'Add question' })).toBeVisible();
  await expect(question(page)).toBeFocused();
  await question(page).fill('A brand new question');
  await page.getByLabel('Option 1 text').fill('Yes');
  await page.getByLabel('Option 2 text').fill('No');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot).toHaveCount(0);
  await expect(page.locator('.questions ul.rows > li').last().locator('.row__title')).toHaveText('A brand new question');
  await expect(page.locator('.questions ul.rows > li').last().getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});

test('a question deleted by someone else while it is open: said in words, the editor closes, and the typed text is offered back (Phase 16)', async ({ page }) => {
  const fake = await site();
  await openContent(page, fake);
  await editOf(page, 6).click();
  await question(page).fill('My careful wording');
  // Another admin deletes it.
  await onSite(fake, async (ds) => {
    const section = await ds.getSection(SECTION) as { questionIds: string[] };
    await ds.updateSection(SECTION, { questionIds: section.questionIds.filter((id) => id !== 'q-many-6') });
    await ds.deleteQuestion('q-many-6');
    for (const id of ['o-many-6-1', 'o-many-6-2']) await ds.deleteOption(id);
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('question-gone')).toContainText('This question was deleted by someone else while you were editing it, so your changes were not saved. You wrote: "My careful wording"');
  await expect(editors(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add it as a new question' }).click();
  await expect(question(page)).toHaveValue('My careful wording');
  await expect(page.locator('.questions li[data-question="new"]')).toBeVisible();
});

for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1366, height: 768 }]) {
  test(`a tall editor (eight picture tiles) keeps Save and Cancel in reach at ${size.width} x ${size.height} (Phase 16)`, async ({ page }) => {
    await page.setViewportSize(size);
    const fake = await site();
    await openContent(page, fake);
    await editOf(page, 10).click();
    await expect(page.getByLabel(/picture address/)).toHaveCount(8);
    const height = await page.locator('.questions .content-editor').evaluate((element) => element.getBoundingClientRect().height);
    expect(height, 'taller than the window').toBeGreaterThan(size.height);
    // Wherever the person is in the editor, the buttons are on the screen.
    for (const label of ['Option 1 picture address', 'Option 5 picture address', 'Option 8 picture address']) {
      await page.getByLabel(label).scrollIntoViewIfNeeded();
      for (const name of ['Save', 'Cancel']) {
        const box = await page.locator('.questions .content-editor').getByRole('button', { name, exact: true }).boundingBox();
        expect(box && box.y >= 0 && box.y + box.height <= size.height + 1, `${name} is on the screen near ${label}`).toBe(true);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
  });
}

test('keyboard only: Edit, type, Save, and the editor passes axe (Phase 16)', async ({ page }) => {
  const fake = await site();
  await openContent(page, fake);
  await editOf(page, 2).focus();
  await page.keyboard.press('Enter');
  await expect(question(page)).toBeFocused();
  await page.keyboard.type(' (keyboard)');
  if (test.info().project.name === 'chromium') {
    const { findings } = await axeCheck(page, 'Content: a question edited in place');
    expect(findings, describeFindings(findings)).toEqual([]);
  }
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(question(page)).toBeFocused();
  await page.keyboard.press('Control+Enter');
  await page.locator('.questions .content-editor').getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(editors(page)).toHaveCount(0);
  await expect(rowOf(page, 2).locator('.row__title')).toHaveText('Question number 2 (keyboard)');
  await expect(editOf(page, 2)).toBeFocused();
});
