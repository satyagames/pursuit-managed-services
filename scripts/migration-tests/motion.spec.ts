import { test, expect, type Page } from '@playwright/test';
import { ds, openAdmin, startLocal, stopLocal, today, type Local } from './admin-local.js';
import { openParticipant, themedSite, THEMES, walkParticipant } from './a11y-support.js';

// Phase 8, part C: prefers-reduced-motion. With the setting on:
//   - the participant page draws no confetti at all (not one canvas is ever added), for a first-try right answer, an activity done and the finale;
//   - nothing animates: the screen that opens, the answer pills, the progress bar and the buttons have no running animation or transition
//     (document.getAnimations() is empty after every step);
//   - the Live display's Auto-advance still moves to the next question every 15 seconds, but the card changes without a transition.
// Without the setting the same walk does draw confetti and does animate, so the checks above can fail.

/** Records every canvas that ever enters the document, and every animation or transition the page starts. */
async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    const seen = { canvases: 0, animations: [] as string[] };
    (window as unknown as { __motion: typeof seen }).__motion = seen;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && (node.tagName === 'CANVAS' || node.querySelector?.('canvas'))) seen.canvases += 1;
    }).observe(document, { childList: true, subtree: true });
    const poll = () => {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect?.getComputedTiming();
        if (timing && Number(timing.duration) > 20) seen.animations.push(`${(animation as { animationName?: string; transitionProperty?: string }).animationName ?? (animation as { transitionProperty?: string }).transitionProperty ?? 'animation'} ${timing.duration}ms`);
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}
const motion = (page: Page) => page.evaluate(() => (window as unknown as { __motion: { canvases: number; animations: string[] } }).__motion);

for (const reduced of [true, false]) {
  test(`participant page, prefers-reduced-motion ${reduced ? 'reduce' : 'no-preference'}: ${reduced ? 'no confetti and nothing animates' : 'it does draw confetti and animate (so the checks can fail)'}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await recordMotion(page);
    const { fake, pack } = await themedSite({ theme: 'kroger' });
    await openParticipant(page, fake);
    // The whole flow: first-try right answers (small bursts), wrong tries, four activities done (medium bursts) and the finale (large).
    await walkParticipant(page, { pack, clientId: THEMES.kroger.clientId }, async () => {});
    await page.waitForTimeout(400);
    const seen = await motion(page);
    if (reduced) {
      expect(seen.canvases, 'not one confetti canvas was ever added to the page').toBe(0);
      expect(seen.animations, 'no animation or transition longer than 20 ms ever ran').toEqual([]);
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    } else {
      expect(seen.canvases, 'confetti is drawn when motion is welcome').toBeGreaterThan(0);
      expect(seen.animations.length, 'and screens do animate').toBeGreaterThan(0);
    }
  });
}

test.describe('the Live display, Auto-advance, with reduced motion', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  test('it still moves to the next question every 15 seconds, and the card changes without a transition', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', "it runs on Playwright's clock, as the other clock-driven specs do (WebKit drops the boundary of a fulfilled $batch)");
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { session } = await ds.activateClient('c-kroger', today);
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: null, answeredAt: new Date().toISOString() }] });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.clock.install({ time: new Date() });
    await openAdmin(page, local);
    await page.getByRole('button', { name: 'Live display' }).click();
    const cards = page.locator('.result-card');
    await expect(cards.first()).toBeVisible();
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
    const place = async () => Number(((await page.locator('.live__eyebrow').textContent()) ?? '').match(/Question (\d+) of/)?.[1]);
    const run = async (ms: number) => { for (let done = 0; done < ms; done += 1000) { await page.clock.runFor(Math.min(1000, ms - done)); await page.waitForTimeout(30); } };
    await page.getByRole('switch', { name: 'Auto-advance every 15 s' }).click();
    expect(await place()).toBe(1);
    await run(15_500);
    expect(await place(), 'it moved on by itself').toBe(2);
    // No transition or animation on the card, on the controls or on the way out, while it did.
    expect(await page.evaluate(() => document.getAnimations().filter((animation) => Number(animation.effect?.getComputedTiming().duration) > 20).length), 'nothing is animating').toBe(0);
    const durations = await page.evaluate(() => ['.result-card', '.result-card .bars__bar', '.live__pager', '.live__eyebrow', 'section.live'].flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
      const style = getComputedStyle(element);
      return `${selector}: ${style.transitionDuration} ${style.animationDuration}`;
    })));
    for (const line of durations) expect(line, 'zero-length transitions and animations').toMatch(/: 0s(, 0s)* 0s(, 0s)*$|: 0s(, 0s)*\s+0s/);
    await run(15_500);
    expect(await place()).toBe(3);
  });
});

