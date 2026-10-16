import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openParticipant, settle, themedSite, THEMES, walkParticipant } from './a11y-support.js';

// Phase 8, part C: what a screen reader is told, read from the accessibility tree with Playwright's ariaSnapshot (Chromium, Firefox and WebKit each
// build their own tree, so each engine has to agree with the same templates). Welcome, the hub, a question (unanswered, right, wrong, the answer
// revealed), the end of an activity and the finale. For each: the landmarks, the headings and their levels, the name of every button, the answer group's
// semantics (a `group` named by the question's own heading, with a button for each answer), and that right and wrong are said in WORDS:
//   - the answer pill itself carries "Correct" or "Incorrect" as text, with an icon (never colour alone);
//   - a polite live region (`role="status"`) says what happened and what to do next, and it says each thing once.
// The tree of each state is also written to test-results/a11y/aria-<state>-<browser>.yml for a person to read.

const out = fileURLToPath(new URL('../../test-results/a11y/', import.meta.url));
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

const save = async (page: Page, state: string, browserName: string) => {
  await settle(page);
  await writeFile(`${out}aria-${state.replace(/[^a-z]+/gi, '-')}-${browserName}.yml`, `${await page.locator('body').ariaSnapshot()}\n`);
};

/** The text the question's live region held, each time it changed: what a screen reader was told, in order. */
async function recordAnnouncements(page: Page) {
  await page.addInitScript(() => {
    const told: string[] = [];
    const last = new WeakMap<Element, string>();
    (window as unknown as { __told: string[] }).__told = told;
    // Each time a status region's words CHANGE to something (a region that is emptied and filled again with the same words says them again).
    new MutationObserver(() => {
      for (const region of document.querySelectorAll('[role="status"]')) {
        const text = (region.textContent ?? '').trim();
        if (text !== (last.get(region) ?? '')) { if (text) told.push(text); last.set(region, text); }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}
const told = (page: Page) => page.evaluate(() => (window as unknown as { __told: string[] }).__told);

test('Welcome, the hub, a question right and wrong, the end of an activity and the finale, as a screen reader gets them', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await recordAnnouncements(page);
  const { fake, pack } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  const main = page.locator('main');
  const banner = page.getByRole('banner');

  await walkParticipant(page, { pack, clientId: THEMES.kroger.clientId }, async (state) => {
    await save(page, state, browserName);
    if (state === 'welcome') {
      await expect(banner).toMatchAriaSnapshot(`
        - img "Deloitte"
        - switch "Sound"
      `);
      // (Phase 9b: Kroger ships with no logo, so there is no picture here: its name is drawn in type on the plate, which carries no words of its own.)
      await expect(main).toMatchAriaSnapshot(`
        - heading "Hi Casey Example!" [level=1]
        - button "Click here to begin"
      `);
    } else if (state === 'hub: a current activity and a locked one') {
      await expect(banner).toMatchAriaSnapshot(`
        - img "Deloitte"
        - text: Hi Casey Example!
        - switch "Sound"
      `);
      await expect(main).toMatchAriaSnapshot(`
        - heading "Kroger Trivia Night" [level=1]
        - list:
          - listitem:
            - button "Kroger's History"
          - listitem:
            - button /Guess the Brand/ [disabled]
          - listitem:
            - button /More question types/ [disabled]
        - button "Home"
      `);
      // A locked activity says why, in text, inside its own button (a screen reader reads it with the name).
      await expect(main.getByRole('button', { name: /Guess the Brand/ })).toHaveAccessibleName('Guess the Brand Finish the previous activity');
      await expect(main.getByRole('button', { name: /Guess the Brand/ })).toHaveAttribute('aria-disabled', 'true');
    } else if (state === 'question, unanswered') {
      await expect(main).toMatchAriaSnapshot(`
        - heading "Kroger's History" [level=1]
        - progressbar "Question 1 of 5"
        - heading /In 1883/ [level=2]
        - group /In 1883/:
          - button "Kroger grocery and Baking co."
          - button "Great Western Tea co."
          - button "Kroger's"
          - button "Kroger"
        - status
        - button "Next" [disabled]
        - button "Home"
      `);
      // The group is named by the question's own heading: one name, said once.
      const heading = page.getByRole('heading', { level: 2 });
      await expect(page.getByRole('group')).toHaveAccessibleName((await heading.innerText()).replace(/^\d+\.\s*/, '').trim());
      await expect(heading).toHaveAttribute('tabindex', '-1');
      // The progress is a real progressbar with its numbers, and a status region is there, empty, ready to speak.
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5');
      await expect(page.locator('.pms-live')).toHaveAttribute('aria-live', 'polite');
      await expect(page.locator('.pms-live')).toHaveText('');
    } else if (state === 'question, wrong, with Retry') {
      await expect(main).toMatchAriaSnapshot(`
        - group /In 1883/:
          - button "Kroger grocery and Baking co. Incorrect" [disabled]
        - status: Incorrect. Press Retry to try again.
        - button "Retry"
        - button "Home"
      `);
      // In words, not colour alone: the pill prints "Incorrect" beside an icon, and the region says it too.
      const pill = page.locator('.pms-options button[data-state="incorrect"]');
      await expect(pill.locator('.verdict')).toHaveText('Incorrect');
      await expect(pill.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.locator('.pms-live')).toHaveText('Incorrect. Press Retry to try again.');
    } else if (state === 'question, answer revealed after two wrong tries') {
      await expect(main).toMatchAriaSnapshot(`
        - status: Incorrect. The correct answer is Great Western Tea co. Press Next to continue.
        - button "Next"
      `);
      await expect(page.locator('.pms-options button[data-state="correct"] .verdict')).toHaveText('Correct');
      await expect(page.locator('.pms-options button[data-state="incorrect"] .verdict')).toHaveText('Incorrect');
    } else if (state === 'question, correct') {
      await expect(main).toMatchAriaSnapshot(`
        - group:
          - button /Correct$/ [disabled]
        - status: Correct. Press Next to continue.
        - button "Next"
      `);
      const pill = page.locator('.pms-options button[data-state="correct"]');
      await expect(pill.locator('.verdict')).toHaveText('Correct');
      await expect(pill.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.locator('.pms-live')).toHaveText('Correct. Press Next to continue.');
    } else if (state === 'activity done') {
      await expect(main).toMatchAriaSnapshot(`
        - heading /Nice work/ [level=1]
        - button "Back to activities"
        - button "Home"
      `);
    } else if (state === 'multiple choice, two picked') {
      // An ungraded choice says which are picked with aria-pressed, not with colour.
      await expect(page.locator('.pms-options button[aria-pressed="true"]')).toHaveCount(2);
      await expect(page.getByRole('group').getByRole('button', { pressed: true })).toHaveCount(2);
    } else if (state === 'ranking, two of three ranked') {
      await expect(page.getByRole('button', { name: /rank 1$/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: /not ranked$/ })).toHaveCount(1);
    } else if (state === 'written answer, empty') {
      const box = page.getByRole('textbox');
      await expect(box).toHaveAccessibleName(/./);
      await expect(box).toHaveAttribute('aria-describedby', /count/);
    } else if (state === 'finale') {
      await expect(main).toMatchAriaSnapshot(`
        - heading /Thank you/ [level=1]
      `);
      expect(await page.getByRole('heading', { level: 1 }).count(), 'one h1 on the finale').toBe(1);
    }
  });

  // What was said, in order, over the whole walk: each verdict once, never the same thing twice running.
  const said = await told(page);
  await writeFile(`${out}aria-announcements-${browserName}.txt`, `${said.join('\n')}\n`);
  expect(said.filter((line) => /^Incorrect\. Press Retry/.test(line)), 'the wrong try is announced once').toHaveLength(1);
  expect(said.filter((line) => /^Incorrect\. The correct answer is Great Western Tea co\. Press Next to continue\.$/.test(line)), 'the reveal is announced once, with one full stop after the answer').toHaveLength(1);
  expect(said.filter((line) => /^Correct\. Press Next/.test(line)).length, 'each right answer is announced').toBeGreaterThanOrEqual(4);
});

test('every activity pill and the sound switch have names, the header is one banner and the page has one main', async ({ page }) => {
  const { fake } = await themedSite({ theme: 'dominos' });
  await openParticipant(page, fake);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  expect(await page.getByRole('main').count()).toBe(1);
  expect(await page.getByRole('banner').count()).toBe(1);
  await expect(page.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const button of await page.getByRole('button').all()) expect((await button.getAttribute('aria-label')) ?? (await button.innerText()), 'a button with no name').toMatch(/\S/);
});
