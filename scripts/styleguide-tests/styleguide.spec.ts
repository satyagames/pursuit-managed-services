import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { confettiCanvas, installAudioStub, installConfettiSpy, readAudio, readConfetti, resetConfetti } from '../migration-tests/effects-support.js';
import { CUES, CUE_NAMES, toneSignature } from '../../migration/src/lib/effects/sound-cues.js';
import { CONFETTI_SIZES, confettiPlan } from '../../migration/src/lib/effects/confetti-plan.js';

// The dev-only #/styleguide: screenshots at phone, iPad and desktop sizes, and an audit of the
// components in every state (tap targets, visible focus, contrast for each palette).

const shots = fileURLToPath(new URL('../../test-results/styleguide/', import.meta.url));
const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];

async function openStyleguide(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto('/#/styleguide');
  await expect(page.locator('#pms-styleguide-root')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return problems;
}

for (const viewport of viewports) {
  test(`styleguide at ${viewport.width}x${viewport.height}: screenshot, no overflow, every control at least 44px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const problems = await openStyleguide(page);

    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}styleguide-${viewport.width}x${viewport.height}.png`, fullPage: true });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll').toBe(true);
    const undersized = await page.evaluate(() => [...document.querySelectorAll('button, [role="switch"], a[href], input, select, textarea')]
      .map((element) => ({ name: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < 43.5 || box.height < 43.5))
      .map(({ name, box }) => `${name}: ${box.width.toFixed(1)}x${box.height.toFixed(1)}`));
    expect(undersized, 'controls under 44px').toEqual([]);
    expect(problems, 'console and page errors').toEqual([]);
  });
}

test('the styleguide shows every component in every state', async ({ page }) => {
  await openStyleguide(page);
  for (const state of ['default', 'selected', 'correct', 'incorrect', 'disabled']) {
    await expect(page.locator(`button.pill[data-state="${state}"]`).first(), `OptionPill ${state}`).toBeVisible();
    await expect(page.locator(`button.tile[data-state="${state}"]`).first(), `LogoTile ${state}`).toBeVisible();
  }
  for (const state of ['default', 'done', 'locked']) {
    await expect(page.locator(`button.activity[data-state="${state}"]`), `ActivityPill ${state}`).toHaveCount(1);
  }
  // Locked says why, in words; correct and incorrect print a word as well as colour.
  await expect(page.getByText('Finish the previous activity')).toBeVisible();
  await expect(page.locator('button.pill[data-state="correct"]').first()).toContainText('Correct');
  await expect(page.locator('button.pill[data-state="incorrect"]').first()).toContainText('Incorrect');
  await expect(page.locator('button.tile[data-state="correct"]').first()).toContainText('Correct');
  await expect(page.locator('button.tile[data-state="incorrect"]').first()).toContainText('Incorrect');
  // Buttons, wordmark, divider, progress, shell.
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next / Submit' })).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Deloitte' }).first()).toBeVisible();
  await expect(page.locator('hr.pms-divider')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveCount(3);
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('figure.frame')).toHaveCount(2);
  // The Phase 2 screen pieces: the sound switch (header and demo), the action row, the hero plate
  // with a logo and with initials, and the check badge.
  await expect(page.getByRole('switch', { name: 'Sound' })).toHaveCount(2);
  await expect(page.locator('.pms-actions')).toHaveCount(1);
  await expect(page.locator('.pms-hero')).toHaveCount(4);
  await expect(page.locator('.pms-hero img')).toHaveCount(1);
  // A client with no logo file: its name in plain ExtraBold type on the plate, never a drawn mark (on the white plate, and on the dark one).
  await expect(page.locator('.pms-hero-text')).toHaveText(["Domino's", "Domino's"]);
  await expect(page.locator('.pms-hero[data-plate="dark"]')).toHaveCount(1);
  await expect(page.locator('.pms-hero-initials')).toHaveText('AF');
  // The two wordings of the screen shown while nothing is live.
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This session has ended.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(1);
  await expect(page.locator('.pms-check')).toHaveCount(1);
});

test('every focusable control shows the green focus ring when reached with the keyboard', async ({ page }) => {
  await openStyleguide(page);
  const seen: { label: string; style: string; width: string; color: string }[] = [];
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
        style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor,
        focusVisible: element.matches(':focus-visible'),
      };
    });
    if (!info) break;
    if (seen.some((item) => item.label === info.label && seen.length > 20 && item === seen[0])) break;
    expect(info.focusVisible, `${info.label} matches :focus-visible`).toBe(true);
    seen.push(info);
  }
  expect(seen.length, 'tabbed through the sound switch, presets, buttons, pills and tiles').toBeGreaterThan(25);
  for (const item of seen) {
    expect(item, `${item.label} has a visible focus ring`).toMatchObject({ style: 'solid', width: '3px', color: 'rgb(134, 188, 37)' });
  }
});

test('each palette keeps white text at 4.5:1 and the derived colours reach the page', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openStyleguide(page);
  await mkdir(shots, { recursive: true });
  const rootToken = (name: string) => page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim().toLowerCase(), name);

  expect(await rootToken('--bg-mid')).toBe('#045bcc');
  for (const [label, bgMid] of [
    [/Domino's/, '#0b648f'],
    [/Primary #0B648F \+ accent #C8102E/, '#0b648f'],
    [/Light #FFD100/, null],
    [/Default #045BCC/, '#045bcc'],
  ] as const) {
    await page.getByRole('button', { name: label }).click();
    const rows = await page.locator('table.contrast tbody tr').allInnerTexts();
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row, `contrast row "${row.replace(/\s+/g, ' ')}" for ${label}`).toMatch(/pass\s*$/);
    const mid = await rootToken('--bg-mid');
    if (bgMid) expect(mid).toBe(bgMid);
    else expect(mid, 'a light primary is darkened, not used as given').not.toBe('#ffd100');
    // Pictures of the client palettes, to look at beside the default one.
    if (/Domino's/.test(String(label))) await page.screenshot({ path: `${shots}styleguide-dominos-820x1180.png`, fullPage: true });
    if (/Light/.test(String(label))) await page.screenshot({ path: `${shots}styleguide-light-primary-820x1180.png`, fullPage: true });
  }
  // An accent never becomes the CTA: the buttons stay the primary's, and the red accent is the
  // ring on the white logo plate only (on this blue it is too weak for the thin rule, which stays white).
  await page.getByRole('button', { name: /Domino's/ }).click();
  const primaryAction = await rootToken('--action');
  await page.getByRole('button', { name: /accent #C8102E/ }).click();
  expect(await rootToken('--action')).toBe(primaryAction);
  expect(primaryAction).toBe('#256c96');
  expect([await rootToken('--accent-ring'), await rootToken('--accent-rule')]).toEqual(['#c8102e', '#ffffff']);
  await expect(page.locator('.notes li')).toContainText(['The thin rule needs 3:1 against the page']);
  const plate = page.locator('.hero-demo .pms-hero').nth(1);
  await plate.scrollIntoViewIfNeeded();
  expect(await plate.evaluate((node) => getComputedStyle(node, '::after').borderTopColor)).toBe('rgb(200, 16, 46)');
  // (Polled: a button's colour takes 160 ms to change with the palette.)
  await expect.poll(() => page.getByRole('button', { name: 'Next', exact: true }).first().evaluate((node) => getComputedStyle(node).backgroundColor), { message: 'a real button is the primary\'s blue' }).toBe('rgb(37, 108, 150)');
  await plate.screenshot({ path: `${shots}styleguide-accent-ring.png` });
  // A light accent has to be darkened, and the page says so.
  await page.getByRole('button', { name: /Light #FFD100/ }).click();
  await expect(page.locator('.notes li').first()).toContainText('too light');
});

test('"Sound and confetti": one button per cue and per size; each plays exactly its own cue or throws its own burst, whatever the header switch says', async ({ page }) => {
  test.setTimeout(60_000);
  await installAudioStub(page);
  await installConfettiSpy(page);
  const problems = await openStyleguide(page);
  const section = page.locator('#pms-audition');
  await expect(section.getByRole('heading', { name: 'Sound and confetti' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Sound' }).first()).toHaveAttribute('aria-checked', 'false');
  expect((await readAudio(page)).contexts, 'nothing is created until a button is tapped').toBe(0);

  await expect(section.locator('button[data-cue]')).toHaveCount(CUE_NAMES.length);
  await expect(section.locator('button[data-confetti]')).toHaveCount(CONFETTI_SIZES.length);

  for (const name of CUE_NAMES) {
    const before = await readAudio(page);
    await section.locator(`button[data-cue="${name}"]`).click();
    const signature = toneSignature(CUES[name]);
    await expect.poll(async () => (await readAudio(page)).oscillators.length - before.oscillators.length, { message: name }).toBeGreaterThanOrEqual(signature.length);
    await page.waitForTimeout(150);
    expect((await readAudio(page)).oscillators.slice(before.oscillators.length), `exactly one "${name}"`).toEqual(signature);
  }
  expect((await readAudio(page)).contexts, 'one shared context').toBe(1);

  const width = await page.evaluate(() => window.innerWidth);
  for (const size of CONFETTI_SIZES) {
    await resetConfetti(page);
    await section.locator(`button[data-confetti="${size}"]`).click();
    await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached' });
    await page.waitForFunction(() => !document.querySelector('canvas[data-pms-confetti]'), null, { polling: 'raf', timeout: 8000 });
    const total = confettiPlan(size, { width })!.reduce((sum, burst) => sum + burst.count, 0);
    expect((await readConfetti(page)).maxPerFrame, `${size} burst`).toBe(total);
  }
  await expect(confettiCanvas(page)).toHaveCount(0);
  expect(problems, 'console and page errors').toEqual([]);
});

test("Setup's pieces (Phase 10b): the panel in order and with a problem, and the list rows, with nothing for axe under each of the four palettes", async ({ page }) => {
  // "This copy of the app" and "Where the lists are" are the Setup page's (migration/src/setup/), which has one light look and never a
  // client's. They are shown here on a card that no palette changes, and looked at under all four: axe-core at WCAG 2.1 A and AA
  // (the tags scripts/migration-tests/a11y.spec.ts uses), every finding a failure, nothing waived.
  await page.setViewportSize({ width: 820, height: 1180 });
  const problems = await openStyleguide(page);
  const samples = page.locator('#pms-setup-samples');
  // (Setup numbers its steps since Phase 10c-3, so the heading is "1. This copy of the app": this test still looked for it unnumbered until Phase 10h.)
  await expect(samples.getByRole('heading', { name: '1. This copy of the app', exact: true })).toHaveCount(2);

  // In order: the eight rows of ARCHITECTURE-10.md 2.3 (in git history at 7347c72), each with where it came from.
  const ready = samples.locator('.setup-card').nth(0);
  await expect(ready.locator('.copy-row')).toHaveCount(8);
  // (The lists are PMS and a meaningful name, twelve of them, since Phase 10c-2b: this test still had the titles of before until Phase 10h.)
  await expect(ready.locator('.copy-row').nth(2)).toHaveText(/Lists\s*PMS3PMSClients, PMS3PMSClientSessions, \.\.\. \(12\) \(prefix "PMS3" from pms-config\.txt\)/);
  await expect(ready.locator('.copy-row').nth(6)).toHaveText(/Label\s*Test, folder 3 \(built in\)/);
  await expect(ready.locator('.copy-problem')).toHaveCount(0);

  // Not set up: the problem in its six parts, the two ways, and what is known all the same.
  const stopped = samples.locator('.setup-card').nth(1);
  await expect(stopped.locator('.copy-problem')).toHaveAttribute('data-problem', 'PMS-CFG-001');
  await expect(stopped.getByRole('heading', { name: 'This copy of the app has not been set up yet' })).toBeVisible();
  await expect(stopped.locator('.copy-problem ol li')).toHaveCount(2);
  await expect(stopped.locator('.copy-problem')).toContainText('Who to ask: Whoever published the app');
  await expect(stopped.locator('.copy-problem')).toContainText('Details: PMS-CFG-001, no listPrefix: pms-config.txt was not found and none is built in');
  await expect(stopped.locator('.copy-row').nth(2)).toHaveText(/Lists\s*Not named yet \(nothing gives a list prefix\)/);

  // The rows: one found where its title says, one that was renamed, one missing, the rest not read.
  const where = samples.locator('.setup-card').nth(2);
  await expect(where.locator('tbody tr')).toHaveCount(13);
  await expect(where.locator('tr[data-list="clients"]')).toContainText('At the address its title suggests.');
  await expect(where.locator('tr[data-list="sessions"]')).toContainText('it was made under another name.');
  await expect(where.locator('tr[data-list="sections"]')).toContainText('There is no list with this title.');
  await expect(where.locator('tr[data-list="questions"]')).toContainText('not read yet');
  await expect(where.getByTestId('address-probe')).toContainText('the same list both ways');
  await expect(where.getByRole('button', { name: 'Read where the lists are' })).toBeEnabled();

  const findings: string[] = [];
  for (const label of [/Default #045BCC/, /Domino's/, /Primary #0B648F \+ accent #C8102E/, /Light #FFD100/]) {
    await page.getByRole('button', { name: label }).click();
    const result = await new AxeBuilder({ page }).include('#pms-setup-samples').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    findings.push(...result.violations.map((violation) => `${label}: ${violation.id} (${violation.help}) on ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`));
    // The card is the same in every look: white, with the navy of the plate.
    expect(await ready.evaluate((card) => getComputedStyle(card).backgroundColor), String(label)).toBe('rgb(255, 255, 255)');
  }
  expect(findings).toEqual([]);
  await mkdir(shots, { recursive: true });
  await samples.screenshot({ path: `${shots}styleguide-setup-samples.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 390').toBe(true);
  await samples.screenshot({ path: `${shots}styleguide-setup-samples-390.png` });
  expect(problems, 'console and page errors').toEqual([]);
});
