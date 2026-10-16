import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startLocal, stopLocal, openAdmin, type Local, today, ds } from './admin-local.js';
import { choices, nextButton, notLivePage, openParticipant, retryButton, settle, themedSite, THEMES, walkParticipant } from './a11y-support.js';
import { layoutProblems, safeAreaRules, type Insets } from './layout-support.js';

// Phase 8, part B: the device profiles, on the participant page and on the admin page, in Chromium, Firefox and WebKit.
//   iPhone portrait (390x844) and landscape (844x390), iPad portrait (820x1180) and landscape (1180x820), iPad Pro portrait (1024x1366),
//   a 1366x768 laptop and a 1440x900 desktop.
// On every screen and state of the participant flow and on every admin tab: no sideways scroll, nothing sticking out or cut off, targets of
// 44x44 px on the touch profiles, and (iPhone) nothing under the notch, the rounded corners or the home indicator. Chromium can emulate the
// safe-area insets (a DevTools override), so the iPhone profiles there are really checked against them; the other two engines cannot, and for
// them the test shows that the stylesheets use all four env(safe-area-inset-*) values. Turning the phone or the iPad over in the middle of a
// question keeps the question, the chosen answer and what the person was looking at.
// Mocked SharePoint and the local server; Playwright's engines on a Mac. No real iPad or iPhone has been involved.

const shots = fileURLToPath(new URL('../../test-results/devices/', import.meta.url));

type Profile = { name: string; slug: string; width: number; height: number; touch: boolean; scale: number; insets: Insets | null };
const PROFILES: Profile[] = [
  { name: 'iPhone portrait', slug: 'iphone-portrait', width: 390, height: 844, touch: true, scale: 3, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'iPhone landscape', slug: 'iphone-landscape', width: 844, height: 390, touch: true, scale: 3, insets: { top: 0, right: 47, bottom: 21, left: 47 } },
  { name: 'iPad portrait', slug: 'ipad-portrait', width: 820, height: 1180, touch: true, scale: 2, insets: null },
  { name: 'iPad landscape', slug: 'ipad-landscape', width: 1180, height: 820, touch: true, scale: 2, insets: null },
  { name: 'iPad Pro portrait', slug: 'ipad-pro-portrait', width: 1024, height: 1366, touch: true, scale: 2, insets: null },
  { name: 'laptop 1366x768', slug: 'laptop-1366x768', width: 1366, height: 768, touch: false, scale: 2, insets: null },
  { name: 'desktop 1440x900', slug: 'desktop-1440x900', width: 1440, height: 900, touch: false, scale: 1, insets: null },
];

async function onDevice(browser: Browser, browserName: string, profile: Profile) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, deviceScaleFactor: profile.scale,
    // (Playwright's Firefox has no mobile mode.)
    isMobile: profile.touch && browserName !== 'firefox',
  });
  const applied: Insets | null = profile.insets && browserName === 'chromium' ? profile.insets : null;
  // Every page of the device has the notch: the DevTools override belongs to a page, so each new one is given it.
  const newPage = async () => {
    const page = await context.newPage();
    if (applied) await (await context.newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: applied });
    return page;
  };
  return { context, page: await newPage(), applied, newPage };
}

test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });

const unique = (list: string[]) => [...new Set(list)];

for (const profile of PROFILES) {
  test(`participant page on ${profile.name}: every screen and state fits, with 44 px targets on touch and the safe areas kept`, async ({ browser, browserName }) => {
    test.setTimeout(180_000);
    const { context, page, applied, newPage } = await onDevice(browser, browserName, profile);
    const { fake, pack } = await themedSite({ theme: 'kroger' });
    await openParticipant(page, fake);
    const problems: string[] = [];
    await walkParticipant(page, { pack, clientId: THEMES.kroger.clientId }, async (state) => {
      await settle(page);
      for (const problem of await layoutProblems(page, { touch: profile.touch, insets: applied })) problems.push(`${state}: ${problem}`);
      if (browserName === 'chromium' && ['welcome', 'question, unanswered', 'question, wrong, with Retry', 'hub: a finished, a current and a locked activity', 'finale'].includes(state)) {
        await page.screenshot({ path: `${shots}${profile.slug}-participant-${state.replace(/[^a-z]+/gi, '-').replace(/-$/, '')}.png` });
      }
    });
    // Not live, and ended, on the same device.
    for (const state of ['not live', 'ended'] as const) {
      const other = await newPage();
      await notLivePage(other, state);
      for (const problem of await layoutProblems(other, { touch: profile.touch, insets: applied })) problems.push(`${state}: ${problem}`);
      await other.close();
    }
    expect(unique(problems)).toEqual([]);
    if (profile.insets) {
      const rules = await safeAreaRules(page);
      expect(rules, 'the stylesheets use the safe-area insets on all four edges').toEqual({ top: expect.any(Number), right: expect.any(Number), bottom: expect.any(Number), left: expect.any(Number) });
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) expect(rules[edge], `a rule uses safe-area-inset-${edge}`).toBeGreaterThan(0);
    }
    await context.close();
  });
}

test.describe('the admin page on every device profile', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  for (const profile of PROFILES) {
    test(`${profile.name}: every tab fits, with 44 px targets on touch`, async ({ browser, browserName }) => {
      test.setTimeout(120_000);
      const { context, page, applied } = await onDevice(browser, browserName, profile);
      await ds.activateClient('c-kroger', today);
      await openAdmin(page, local);
      const problems: string[] = [];
      const look = async (label: string) => { await settle(page); for (const problem of await layoutProblems(page, { touch: profile.touch, insets: applied })) problems.push(`${label}: ${problem}`); };
      await look('Today');
      for (const tab of ['Clients', 'Content', 'Guests and QR', 'Results']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByRole('heading', { name: tab, exact: true }).first()).toBeVisible();
        await look(tab);
      }
      await page.getByRole('tab', { name: 'Today', exact: true }).click();
      await page.getByRole('button', { name: 'Live display' }).click();
      await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
      await look('Live display');
      if (browserName === 'chromium') await page.screenshot({ path: `${shots}${profile.slug}-admin-live-display.png` });
      expect(unique(problems)).toEqual([]);
      await context.close();
    });
  }
});

// ---- Turning the device over in the middle of a question -------------------------------------------------------------------------------

const TURNS: [Profile, Profile][] = [
  [PROFILES[0], PROFILES[1]], // iPhone: portrait -> landscape
  [PROFILES[3], PROFILES[2]], // iPad: landscape -> portrait
  [PROFILES[2], PROFILES[3]], // iPad: portrait -> landscape
];

const inView = (locator: ReturnType<Page['locator']>) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
});

for (const [from, to] of TURNS) {
  for (const state of ['correct', 'incorrect'] as const) {
    test(`turning an ${from.name.split(' ')[0]} from ${from.name.split(' ').slice(1).join(' ')} to ${to.name.split(' ').slice(1).join(' ')} with ${state === 'correct' ? 'a right answer' : 'a wrong answer'} chosen keeps the question, the choice and what was in view; and back again`, async ({ browser, browserName }) => {
      test.setTimeout(120_000);
      const { context, page } = await onDevice(browser, browserName, from);
      const { fake, pack } = await themedSite({ theme: 'kroger' });
      await openParticipant(page, fake);
      const section = pack.sections.filter((entry) => entry.clientId === 'c-kroger').sort((a, b) => a.order - b.order)[0];
      const questions = pack.questions.filter((question) => question.sectionId === section.id).sort((a, b) => a.order - b.order);
      const optionsOf = (id: string) => pack.options.filter((option) => option.questionId === id);
      const right = (id: string) => optionsOf(id).findIndex((option) => option.correct === true);
      const wrong = (id: string) => optionsOf(id).findIndex((option) => option.correct !== true);

      await page.getByRole('button', { name: 'Click here to begin' }).click();
      await page.getByRole('button', { name: new RegExp(`^${section.title}`) }).first().click();
      await choices(page).nth(right(questions[0].id)).click();
      await nextButton(page).click();
      await expect(page.getByRole('progressbar', { name: `Question 2 of ${questions.length}` })).toBeVisible();
      await choices(page).nth(state === 'correct' ? right(questions[1].id) : wrong(questions[1].id)).click();
      await expect(state === 'correct' ? nextButton(page) : retryButton(page)).toBeVisible();

      const heading = page.getByRole('heading', { level: 2 });
      const chosen = page.locator(`.pms-options button[data-state="${state}"]`);
      await expect(chosen).toHaveCount(1);
      await chosen.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const snapshot = async () => ({
        heading: await heading.innerText(),
        states: await choices(page).evaluateAll((all) => all.map((button) => button.getAttribute('data-state'))),
        chosenText: await chosen.innerText(),
        progress: await page.getByRole('progressbar').first().getAttribute('aria-valuenow'),
      });
      const before = await snapshot();
      expect(await inView(chosen), 'the chosen answer is in view before turning').toBe(true);

      for (const target of [to, from]) {
        await page.setViewportSize({ width: target.width, height: target.height });
        await settle(page);
        // (Two frames for the page to be laid out for its new shape and to put back what was in view.)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
        expect(await snapshot(), `turned to ${target.name}: the same question, the same choice`).toEqual(before);
        await expect(state === 'correct' ? nextButton(page) : retryButton(page), 'the action is still there').toBeVisible();
        expect(await inView(chosen), `turned to ${target.name}: the chosen answer is still in view`).toBe(true);
        expect(unique(await layoutProblems(page, { touch: true, insets: browserName === 'chromium' && target.insets ? target.insets : null })), `turned to ${target.name}`).toEqual([]);
      }
      await context.close();
    });
  }
}
