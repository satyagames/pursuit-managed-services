import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seedPack } from '../../migration/src/lib/seed.js';
import { PIN, activityRow, adminUrl, ds, openAdmin, startLocal, stopLocal, today, useServer, type Local } from './admin-local.js';
import { a11yPack, axeCheck, describeFindings, notLivePage, openParticipant, themedSite, THEMES, THEME_KEYS, walkParticipant, type Finding } from './a11y-support.js';
import { newFake, pageUrl, serveSharePoint } from './sharepoint.js';
import { sharePointFolderPath } from '../deployment-config.js';

// Phase 8, part C: axe-core at WCAG 2.1 A and AA (wcag2a, wcag2aa, wcag21a, wcag21aa) on every participant screen and state, in four looks
// (the default one, Kroger's and Domino's sample themes, and one with a LIGHT primary colour), on the unsupported-browser page, and on every
// admin tab, dialog and view. Every violation fails the test; there are no silent waivers (a rule that cannot be satisfied would be written down
// in AGENTS.md and QA-TESTING.md with its reason, and named here). axe's "needs review" results (it cannot decide a contrast over a gradient)
// are counted and written to test-results/a11y/axe-incomplete.txt; the contrast of those is measured from pixels by contrast.spec.ts.
// axe-core is a dev dependency and is in no built page (scripts/test-bundle-budget.js says so). Run on Chromium.

const out = fileURLToPath(new URL('../../test-results/a11y/', import.meta.url));
const incomplete: string[] = [];
const checked: string[] = [];

test.beforeAll(async () => { await mkdir(out, { recursive: true }); });
test.afterAll(async () => {
  await writeFile(`${out}axe-incomplete.txt`, `${incomplete.join('\n')}\n`);
  await writeFile(`${out}axe-checked.txt`, `${checked.join('\n')}\n`);
  console.log(`axe: ${checked.length} screens and states checked, ${incomplete.length} "needs review" items (test-results/a11y/axe-incomplete.txt)`);
});

/**
 * axe counts words of exactly the colour of what is behind them (1:1) as "needs review", never as a violation (they may be hidden on purpose): the
 * Setup page's primary buttons were exactly that until Phase 10h. Where it is checked, it is a failure: the "needs review" items of `where` at 1:1.
 */
const sameColour = (where: string) => incomplete.filter((item) => item.startsWith(`${where}: color-contrast`) && /\b1:1 contrast ratio\b/.test(item));

async function check(page: Page, where: string, options?: Parameters<typeof axeCheck>[2]) {
  const result = await axeCheck(page, where, options);
  incomplete.push(...result.incomplete);
  checked.push(where);
  return result.findings;
}

test.describe('participant page', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  for (const theme of THEME_KEYS) {
    test(`every screen and state, ${theme} look`, async ({ page }) => {
      test.setTimeout(240_000);
      const { fake, pack } = await themedSite({ theme });
      await openParticipant(page, fake);
      const findings: Finding[] = [];
      await walkParticipant(page, { pack, clientId: THEMES[theme].clientId }, async (state) => { findings.push(...await check(page, `participant, ${theme}: ${state}`)); });
      expect(describeFindings(findings)).toBe('');
    });
  }

  test('on a phone, in the default look: the same screens, narrow', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { fake, pack } = await themedSite({ theme: 'default' });
    await openParticipant(page, fake);
    const findings: Finding[] = [];
    await walkParticipant(page, { pack, clientId: THEMES.default.clientId }, async (state) => { findings.push(...await check(page, `participant, phone: ${state}`)); });
    expect(describeFindings(findings)).toBe('');
  });

  test('not live, session ended, and a server that cannot be reached', async ({ page, context }) => {
    const findings: Finding[] = [];
    await notLivePage(page, 'not live');
    findings.push(...await check(page, 'participant: not live'));
    const ended = await context.newPage();
    await ended.setViewportSize({ width: 820, height: 1180 });
    await notLivePage(ended, 'ended');
    findings.push(...await check(ended, 'participant: session ended'));
    const unreachable = await context.newPage();
    await unreachable.setViewportSize({ width: 820, height: 1180 });
    await unreachable.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/index.html')) return route.continue();
      return route.abort();
    });
    await unreachable.goto(`${sharePointFolderPath}/index.html`);
    await expect(unreachable.getByRole('heading', { name: /We can.t reach the server/ })).toBeVisible();
    findings.push(...await check(unreachable, 'participant: the server cannot be reached'));
    expect(describeFindings(findings)).toBe('');
  });

  test('a participant page under Brand Studio\'s preview address (?preview=<client>)', async ({ page }) => {
    const { fake } = await themedSite({ theme: 'light', live: false });
    await (await import('./sharepoint.js')).serveSharePoint(page, fake);
    await page.goto((await import('./sharepoint.js')).pageUrl('index.html?preview=c-lemon'));
    await expect(page.getByRole('button', { name: /begin|Activities/i }).first()).toBeVisible();
    expect(describeFindings(await check(page, 'participant: preview address'))).toBe('');
  });
});

test('negative control: axe does find what is wrong (an image with no text, a button with no name, a field with no label, and poor contrast)', async ({ page }) => {
  const { fake } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button><input type="text"><p style="color:#777;background:#888">Hard to read</p>');
  });
  const found = (await check(page, 'negative control')).map((finding) => finding.rule);
  for (const rule of ['image-alt', 'button-name', 'label', 'color-contrast']) expect(found, `axe reports ${rule}`).toContain(rule);
});

test.describe('the unsupported-browser notice', () => {
  for (const file of ['index.html', 'admin.html', 'setup.html']) {
    // (With scripting off axe cannot run at all: it is a script. That state is the same words in the same black on white; the notice spec looks at it.)
    test(`${file}: shown by a missing feature, on an iPad and on a phone`, async ({ page }) => {
      await page.addInitScript(() => { Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true }); });
      const findings: Finding[] = [];
      for (const size of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        await page.goto(`${sharePointFolderPath}/${file}`);
        await expect(page.locator('#pms-unsupported')).toBeVisible();
        findings.push(...await check(page, `unsupported notice, ${file}, ${size.width} wide`));
      }
      expect(describeFindings(findings)).toBe('');
    });
  }
});

// ---- The admin ------------------------------------------------------------------------------------------------------------------------

test.describe('admin', () => {
  // (A step that cannot find its control says so in seconds, not at the end of the test.)
  test.use({ actionTimeout: 8_000 });
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  const PERSON = (trackId: string, sessionId: string, clientId: string, questionIds: string[]) => ds.saveParticipantResponses({
    trackId, sessionId, clientId, responses: questionIds.map((questionId) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: new Date().toISOString() })),
  });

  test('the PIN gate, then every tab, its dialogs and views, at a laptop width and on a phone', async ({ page }) => {
    test.setTimeout(240_000);
    await seedPack(ds, a11yPack());
    const findings: Finding[] = [];
    await useServer(page, local);
    for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const at = `${size.width}`;
      await page.setViewportSize(size);
      await page.goto(adminUrl);
      await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();
      findings.push(...await check(page, `admin ${at}: PIN gate`));
      await page.getByRole('textbox', { name: 'PIN' }).fill('0000');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      findings.push(...await check(page, `admin ${at}: PIN gate, wrong PIN`));
      await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');

      // Today: nothing live, a client picked, then live.
      findings.push(...await check(page, `admin ${at}: Today, nothing live`));
      await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
      await expect(page.locator('[data-check="lists"]')).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Today, a client picked, with readiness`));
      // (The second pass finds Kroger already live from the first.)
      if (await page.getByRole('button', { name: 'Go live', exact: true }).count()) {
        await page.getByRole('button', { name: 'Go live', exact: true }).click();
        await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
      } else await expect(page.getByRole('button', { name: 'Already live' })).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Today, live`));

      // Clients, its form, and Brand Studio for each look.
      await page.getByRole('tab', { name: 'Clients', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Clients', exact: true }).first()).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Clients`));
      await page.getByRole('button', { name: /Add client/ }).click();
      findings.push(...await check(page, `admin ${at}: Clients, the Add client form`));
      await page.keyboard.press('Escape');
      for (const [theme, name] of [['kroger', 'Kroger'], ['dominos', "Domino's"], ['light', 'Lemon Co'], ['default', 'Plain Co']] as const) {
        await page.getByRole('tab', { name: 'Clients', exact: true }).click();
        await page.getByRole('button', { name: `Brand: ${name}` }).click();
        await expect(page.getByRole('heading', { name: /Brand/ }).first()).toBeVisible();
        findings.push(...await check(page, `admin ${at}: Brand Studio, ${theme} look`));
        await page.getByRole('button', { name: '← Clients' }).click();
      }

      // Content with its dialogs.
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Content', exact: true }).first()).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Content`));
      for (const [button, label] of [[/Add activity/, 'the Add activity form'], [/Copy from another client/, 'the Copy dialog']] as const) {
        const control = page.getByRole('button', { name: button }).first();
        if (await control.isVisible().catch(() => false)) {
          await control.click();
          findings.push(...await check(page, `admin ${at}: Content, ${label}`));
          await page.keyboard.press('Escape');
        }
      }

      // Guests and QR (a few guests, a code each), and the print sheet.
      await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Guests and QR', exact: true }).first()).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Guests and QR`));

      // Results.
      await page.getByRole('tab', { name: 'Results', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Results', exact: true }).first()).toBeVisible();
      findings.push(...await check(page, `admin ${at}: Results`));
      await page.getByRole('button', { name: 'Lock' }).click();
    }
    expect(describeFindings(findings)).toBe('');
  });

  test('the Live display (and full screen) in each look, and the print sheet, with a few people in the session', async ({ page }) => {
    test.setTimeout(240_000);
    await seedPack(ds, a11yPack());
    const findings: Finding[] = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    const sessions: Record<string, { id: string }> = {};
    for (const theme of THEME_KEYS) {
      const clientId = THEMES[theme].clientId;
      const { session } = await ds.activateClient(clientId, today);
      sessions[theme] = session;
      const first = (await ds.listSections()).find((section: { clientId: string }) => section.clientId === clientId) as { id: string; questionIds: string[] };
      for (let person = 0; person < 3; person += 1) {
        const track = await ds.beginVisit(crypto.randomUUID(), session.id, clientId);
        await PERSON(track.id, session.id, clientId, first.questionIds.slice(0, person + 1));
      }
    }
    await openAdmin(page, local);
    // (Each client's session by its address, #live-display/<session>: the display paints the client's own colours.)
    for (const theme of THEME_KEYS) {
      await page.evaluate((hash) => { location.hash = hash; }, `#live-display/${sessions[theme].id}`);
      await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
      await expect(page.locator('.result-card').first()).toBeVisible();
      findings.push(...await check(page, `Live display, ${theme} look`));
      await page.getByRole('button', { name: 'Full screen' }).click();
      await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
      findings.push(...await check(page, `Live display, full screen, ${theme} look`));
      await page.keyboard.press('Escape');
      await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'false');
    }
    // The print sheet: the live session (the last client activated), guests with a code each.
    const live = sessions.light; // the last client made live is the live one
    await ds.setSessionParticipationMode(live.id, 'client-visit');
    for (const name of ['Jordan Lee', 'Łukasz Żółć', 'José Álvarez']) {
      const guest = await ds.createVisitor({ sessionId: live.id, displayName: name, enabled: true });
      await ds.provisionQrToken(THEMES.light.clientId, live.id, { visitorId: guest.id });
    }
    await page.evaluate(() => { location.hash = '#guests'; });
    await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
    await expect(page.locator('li.row[data-guest]').first()).toBeVisible();
    findings.push(...await check(page, 'Guests and QR, with three guests and their codes'));
    await page.getByRole('button', { name: /^Print QR sheet/ }).click();
    await expect(page.locator('[data-card]').first()).toBeVisible();
    findings.push(...await check(page, 'the print sheet'));
    expect(describeFindings(findings)).toBe('');
  });

  test('the setup page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${sharePointFolderPath}/setup.html`);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(describeFindings(await check(page, 'setup page'))).toBe('');
    expect(sameColour('setup page'), 'words the colour of their background (Phase 10h)').toEqual([]);
  });

  // Phase 10h: axe passes a button that is switched off, and Setup's primary buttons are off as the page opens, so the white words on no background
  // the real site's deployer met were never measured. Here every one of them is on: a ready site after Check Lists, a name typed, a file chosen.
  test('the setup page on a ready site, with Add an admin, Seed sample clients and Import switched on', async ({ page }) => {
    const fake = newFake();
    await serveSharePoint(page, fake);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl('setup.html'));
    await page.getByRole('button', { name: 'Check Lists', exact: true }).click();
    await expect(page.getByTestId('lists-status')).toContainText('All list schemas ready.');
    await page.getByLabel('Name', { exact: true }).fill('Casey Example');
    await page.getByLabel('Private seed file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, data: { clients: [] } })) });
    for (const name of ['Add an admin', 'Seed sample clients', 'Import Missing Records']) await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
    expect(describeFindings(await check(page, 'setup page, a ready site, its primary buttons on'))).toBe('');
    expect(sameColour('setup page, a ready site, its primary buttons on'), 'words the colour of their background (Phase 10h)').toEqual([]);
  });
});
