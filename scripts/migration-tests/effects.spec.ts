import { test, expect, type Page } from '@playwright/test';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi, type Fixture } from './fixtures.js';
import {
  confettiCanvas, installAudioStub, installConfettiSpy, readAudio, readConfetti, resetConfetti, type StubOptions,
} from './effects-support.js';
import { CUES, toneSignature, type CueName } from '../../migration/src/lib/effects/sound-cues.js';
import { buildPalette, confettiPlan, isRedish, parseColor, type ConfettiSize } from '../../migration/src/lib/effects/confetti-plan.js';

// Phase 3: sound and confetti against the built release page with a synthetic API.
//
// The AudioContext is replaced by a recorder (effects-support.ts), so these tests can say exactly which
// notes the app asked for; each cue has its own fingerprint (its tone frequencies in start order), and the
// audio render guard (effects-audio.spec.ts) separately measures what those cues sound like. The 2D canvas
// is wrapped to count the pieces and read the colours canvas-confetti really draws.
//
// They run on Chromium and on WebKit (the engine of every iPad browser).

const appPath = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;
const choice = (page: Page, index: number) => page.locator('.pms-options button').nth(index);
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
const retry = (page: Page) => page.getByRole('button', { name: 'Retry', exact: true });
const toggle = (page: Page) => page.getByRole('switch', { name: 'Sound' });
const begin = (page: Page) => page.getByRole('button', { name: 'Click here to begin' });
const activity = (page: Page, name: string | RegExp) => page.getByRole('button', { name });

type Opened = { fixture: Fixture; right: (questionId: string) => string; problems: string[] };

/** Opens the app on a visitor's track with the flow content, the audio recorder and the confetti counter installed. */
async function open(page: Page, { hash = '#/welcome?t=track-a', audio = {} as StubOptions | false, seed = [] as string[] } = {}): Promise<Opened> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  const fixture = await mockApi(page);
  const { right } = addFlowContent(fixture, { flow: 'open' });
  makeVisitor(fixture);
  answered(fixture, right, seed);
  if (audio !== false) await installAudioStub(page, audio);
  await installConfettiSpy(page);
  await page.goto(appPath(hash));
  return { fixture, right, problems };
}

/** Marks questions as already answered right, so a test can start part-way through. */
function answered(fixture: Fixture, right: (id: string) => string, ids: string[]) {
  fixture.give(ids.map((id) => ({ questionId: id, answer: id === 'q-p1' ? 'q-p1-a' : right(id) })));
}

const planTotal = (size: ConfettiSize, width: number) => confettiPlan(size, { width })!.reduce((sum, burst) => sum + burst.count, 0);

// How long each size of confetti may live: the brief says about 0.8 s, 1.5 s and 2.5 s.
const LIFETIME_MS: Record<ConfettiSize, [number, number]> = { small: [500, 1600], medium: [1000, 2600], large: [2000, 3800] };

/**
 * Does one thing in the app and checks everything it should (and should not) cause: exactly the
 * expected cue (by fingerprint) and nothing else, and the expected confetti, which must come and go.
 */
async function step(page: Page, expected: { cue: CueName | null; confetti: ConfettiSize | null }, action: () => Promise<unknown>, { soundOn = true } = {}) {
  const before = await readAudio(page);
  await resetConfetti(page);
  await action();

  const wantedCue = soundOn ? expected.cue : null;
  const signature = wantedCue ? toneSignature(CUES[wantedCue]) : [];
  if (signature.length) {
    await expect.poll(async () => (await readAudio(page)).oscillators.length - before.oscillators.length, { message: `${wantedCue} should start`, timeout: 6000 }).toBeGreaterThanOrEqual(signature.length);
  }
  let appeared = 0;
  if (expected.confetti) {
    await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached', timeout: 6000 });
    appeared = Date.now();
  }
  await page.waitForTimeout(200); // a duplicate cue or a stray burst would arrive in this time

  const after = await readAudio(page);
  expect(after.oscillators.slice(before.oscillators.length), wantedCue ? `exactly one "${wantedCue}"` : 'no sound').toEqual(signature);
  expect(after.noise - before.noise, 'only the tick uses noise').toBe(wantedCue === 'pick' ? 1 : 0);

  if (expected.confetti) {
    await expect(confettiCanvas(page), `${expected.confetti} confetti is showing`).toHaveCount(1);
    await page.waitForFunction(() => !document.querySelector('canvas[data-pms-confetti]'), null, { polling: 'raf', timeout: 8000 });
    const lifetime = Date.now() - appeared;
    const [shortest, longest] = LIFETIME_MS[expected.confetti];
    expect(lifetime, `${expected.confetti} confetti lived ${lifetime} ms and was then removed`).toBeGreaterThanOrEqual(shortest);
    expect(lifetime).toBeLessThanOrEqual(longest);
    const width = await page.evaluate(() => window.innerWidth);
    const drawn = await readConfetti(page);
    expect(drawn.added, 'one overlay for the whole celebration').toBe(1);
    expect(drawn.maxPerFrame, `${expected.confetti} pieces at ${width}px wide`).toBe(planTotal(expected.confetti, width));
  } else {
    // Not "eventually zero" (a canvas that comes and goes would pass that): none was ever added.
    expect((await readConfetti(page)).added, 'no confetti overlay appeared, not even briefly').toBe(0);
    expect(await confettiCanvas(page).count()).toBe(0);
  }
}

/** The whole participant flow, one moment at a time. */
async function playThrough(page: Page, soundOn: boolean) {
  const s = (cue: CueName | null, confetti: ConfettiSize | null, action: () => Promise<unknown>) => step(page, { cue, confetti }, action, { soundOn });

  if (soundOn) await s('soundOn', null, () => toggle(page).click());
  await s(null, null, () => begin(page).click());
  await s(null, null, () => activity(page, "Alpha's History").click());
  // Question 1: wrong, Retry, right (a right answer after a retry is a quieter note and no confetti).
  await s('incorrect', null, () => choice(page, 2).click());
  await s(null, null, () => retry(page).click());
  await s('correctRetry', null, () => choice(page, 1).click());
  await s(null, null, () => next(page).click());
  // Question 2: right first time.
  await s('correctFirst', 'small', () => choice(page, 2).click());
  await s(null, null, () => next(page).click());
  // Question 3: wrong, Retry, wrong again: the answer is revealed.
  await s('incorrect', null, () => choice(page, 1).click());
  await s(null, null, () => retry(page).click());
  await s('revealed', null, () => choice(page, 2).click());
  await s('activityComplete', 'medium', () => submit(page).click());
  await s(null, null, () => page.getByRole('button', { name: 'Back to activities' }).click());
  // The logo-tile activity: two right first time.
  await s(null, null, () => activity(page, /Guess the Brand/).click());
  await s('correctFirst', 'small', () => choice(page, 1).click());
  await s(null, null, () => next(page).click());
  await s('correctFirst', 'small', () => choice(page, 3).click());
  await s('activityComplete', 'medium', () => submit(page).click());
  await s(null, null, () => page.getByRole('button', { name: 'Back to activities' }).click());
  // The poll: nothing is graded, so a choice is a soft tick and never a verdict.
  await s(null, null, () => activity(page, /Quick pulse/).click());
  await s('pick', null, () => choice(page, 0).click());
  await s('pick', null, () => choice(page, 1).click());
  await s('activityComplete', 'medium', () => submit(page).click());
  await s('finale', 'large', () => page.getByRole('button', { name: 'Finish', exact: true }).click());
  await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
  // Home is as quiet as Next and Back.
  await s(null, null, () => page.getByRole('button', { name: 'Home', exact: true }).click());
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
}

// ---- Every moment, sound on and off -------------------------------------------------------------------

test('sound ON: every moment makes exactly its own cue and its own confetti, and Next, Back and Home make none', async ({ page }) => {
  test.setTimeout(120_000);
  const { problems } = await open(page);
  await playThrough(page, true);
  expect(problems, 'console and page errors').toEqual([]);
});

test('sound OFF: no audio node ever starts and no AudioContext is created, but the confetti still shows', async ({ page }) => {
  test.setTimeout(120_000);
  const { problems } = await open(page);
  await playThrough(page, false);
  const log = await readAudio(page);
  expect(log.contexts, 'no AudioContext').toBe(0);
  expect(log.oscillators.length + log.noise + log.blips, 'no audio node started').toBe(0);
  expect(problems).toEqual([]);
});

test('turning sound off after it was on silences it: no cue starts, though the confetti still shows', async ({ page }) => {
  await open(page, { hash: '#/quiz/section-history?t=track-a' });
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  await toggle(page).click(); // on: the chime, and an AudioContext now exists
  await expect.poll(async () => (await readAudio(page)).oscillators.length).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await toggle(page).click(); // off
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  const before = await readAudio(page);
  expect(before.contexts).toBe(1);
  await resetConfetti(page);
  await choice(page, 2).click(); // wrong: would be "incorrect"
  await retry(page).click();
  await choice(page, 1).click(); // right after a retry: would be "correctRetry"
  await next(page).click();
  await choice(page, 2).click(); // right first time: would be "correctFirst", and confetti
  await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached' });
  await page.waitForTimeout(400);
  const after = await readAudio(page);
  expect(after.oscillators, 'no cue started while sound was off').toEqual(before.oscillators);
  expect(after.noise).toBe(before.noise);
  expect((await readConfetti(page)).added, 'confetti is independent of sound').toBe(1);
});

test('the same cue repeated within 80 ms is ignored; the same cue a moment later plays', async ({ page }) => {
  await open(page, { hash: '#/quiz/section-pulse?t=track-a' });
  await expect(page.getByRole('group', { name: /Which topic/ })).toBeVisible();
  await toggle(page).click();
  await expect.poll(async () => (await readAudio(page)).oscillators.length).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const before = await readAudio(page);
  // Two taps in the same task: the second is inside the 80 ms window.
  await page.evaluate(() => {
    const buttons = document.querySelectorAll<HTMLElement>('.pms-options button');
    buttons[0].click();
    buttons[1].click();
  });
  await page.waitForTimeout(250);
  const twice = await readAudio(page);
  expect(twice.noise - before.noise, 'one tick, not two').toBe(1);
  await choice(page, 2).click();
  await page.waitForTimeout(250);
  expect((await readAudio(page)).noise - before.noise, 'a later tick plays').toBe(2);
});

// ---- Autoplay, persistence, the audio session ----------------------------------------------------------------

test('autoplay: no AudioContext exists after the page loads; the first tap on the switch creates one, and it is the only one', async ({ page }) => {
  const { problems } = await open(page);
  await expect(begin(page)).toBeVisible();
  expect((await readAudio(page)).contexts, 'nothing at load').toBe(0);
  await begin(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
  expect((await readAudio(page)).contexts, 'a tap with sound off creates nothing').toBe(0);

  await toggle(page).click();
  await expect.poll(async () => (await readAudio(page)).contexts).toBe(1);
  await toggle(page).click(); // off
  await toggle(page).click(); // on again
  await page.waitForTimeout(200);
  const log = await readAudio(page);
  expect(log.contexts, 'one shared AudioContext, however many times the switch is used').toBe(1);
  expect(log.blips, 'the silent unlock sample played once, when the context was made').toBe(1);
  expect(problems).toEqual([]);
});

test('autoplay: a saved "on" still creates nothing at load; "Click here to begin" is the tap that starts audio, and it makes no sound', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.setItem('pms.sound', 'on'));
  await page.reload();
  await expect(begin(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect((await readAudio(page)).contexts, 'a saved choice alone starts nothing').toBe(0);

  await begin(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
  const log = await readAudio(page);
  expect(log.contexts, 'the Welcome tap created the context').toBe(1);
  expect(log.oscillators, 'and played nothing').toEqual([]);
  expect(log.state).toBe('running');
});

test('the choice persists across a reload, on and off, under the key pms.sound', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => localStorage.getItem('pms.sound'))).toBeNull();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('pms.sound'))).toBe('on');
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('pms.sound'))).toBe('off');
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
});

test('the audio session is "playback" while sound is on, so the ringer switch does not mute it, and "auto" when it is off', async ({ page }) => {
  await open(page, { audio: { audioSession: true } });
  expect((await readAudio(page)).session, 'untouched at load').toBe('auto');
  await toggle(page).click();
  await expect.poll(async () => (await readAudio(page)).session).toBe('playback');
  await toggle(page).click();
  await expect.poll(async () => (await readAudio(page)).session).toBe('auto');
});

test('a context that goes to sleep (suspended, or Safari\'s interrupted) is resumed when the page returns and on the next tap, and the next cue still plays', async ({ page }) => {
  await open(page, { audio: { audioSession: true } });
  await toggle(page).click();
  await expect.poll(async () => (await readAudio(page)).state).toBe('running');
  const sleep = (state: string) => page.evaluate((next) => (window as unknown as { __audioContext: { setState(state: string): void } }).__audioContext.setState(next), state);

  await sleep('interrupted');
  expect((await readAudio(page)).state).toBe('interrupted');
  const resumesBefore = (await readAudio(page)).resumes;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the page is visible again
  await expect.poll(async () => (await readAudio(page)).state, { message: 'resumed when visible again' }).toBe('running');
  expect((await readAudio(page)).resumes).toBeGreaterThan(resumesBefore);

  await sleep('suspended');
  await page.getByRole('heading', { level: 1 }).click(); // any tap
  await expect.poll(async () => (await readAudio(page)).state, { message: 'resumed by the next tap' }).toBe('running');

  // And a cue asked for while the context is asleep wakes it and then plays.
  await begin(page).click();
  await activity(page, "Alpha's History").click();
  const before = await readAudio(page);
  await sleep('interrupted');
  await choice(page, 1).click();
  await expect.poll(async () => (await readAudio(page)).oscillators.length - before.oscillators.length).toBe(toneSignature(CUES.correctFirst).length);
  expect((await readAudio(page)).oscillators.slice(before.oscillators.length)).toEqual(toneSignature(CUES.correctFirst));
});

// ---- Failure: the app still works silently ----------------------------------------------------------------------

async function completeHistory(page: Page) {
  await begin(page).click();
  await activity(page, "Alpha's History").click();
  await choice(page, 1).click();
  await next(page).click();
  await choice(page, 2).click();
  await next(page).click();
  await choice(page, 0).click();
  await submit(page).click();
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
}

test('with no AudioContext at all the pager still completes and the switch is disabled with its reason', async ({ page }) => {
  const { problems } = await open(page, { audio: { mode: 'missing' } });
  await expect(begin(page)).toBeVisible();
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute('title', "Sound isn't available in this browser");
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await completeHistory(page);
  expect(problems, 'no console or page errors').toEqual([]);
});

test('if the AudioContext constructor throws, the tap that tried it leaves the app working and the switch disabled', async ({ page }) => {
  const { problems } = await open(page, { audio: { mode: 'throws' } });
  await expect(toggle(page)).toBeEnabled();
  await toggle(page).click();
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute('title', "Sound isn't available in this browser");
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('pms.sound')), 'an "on" that can never be heard is not kept').not.toBe('on');
  await completeHistory(page);
  // Console errors from the throwing constructor itself are the only ones allowed; the app logged none of its own.
  expect(problems.filter((message) => !/Synthetic: AudioContext/.test(message))).toEqual([]);
});

// ---- Confetti --------------------------------------------------------------------------------------------------

test('the confetti overlay is fixed, full-screen, hidden from assistive tech and never blocks a tap', async ({ page }) => {
  const { problems } = await open(page, { hash: '#/quiz/section-history?t=track-a' });
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  await choice(page, 1).click();
  await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached' });

  const overlay = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-pms-confetti]')!;
    const style = getComputedStyle(canvas);
    const rect = canvas.getBoundingClientRect();
    const nextButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Next')!;
    const box = nextButton.getBoundingClientRect();
    return {
      position: style.position, pointerEvents: style.pointerEvents, ariaHidden: canvas.getAttribute('aria-hidden'),
      covers: Math.round(rect.width) === window.innerWidth && Math.round(rect.height) === window.innerHeight && rect.left === 0 && rect.top === 0,
      onTop: Number(style.zIndex) >= 1000,
      tapGoesTo: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === nextButton,
      scrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(overlay).toEqual({ position: 'fixed', pointerEvents: 'none', ariaHidden: 'true', covers: true, onTop: true, tapGoesTo: true, scrollsSideways: false });

  // Tapping Next while the confetti is still falling works.
  await next(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  expect(await confettiCanvas(page).count(), 'it was still there').toBe(1);
  await expect(confettiCanvas(page)).toHaveCount(0, { timeout: 4000 });
  expect(problems).toEqual([]);
});

test('confetti colours are Deloitte green, white, --success and light tints of --action and the client colour, and never red', async ({ page }) => {
  await open(page, { hash: '#/quiz/section-history?t=track-a' });
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return { success: read('--success'), action: read('--action'), primary: read('--brand-primary') };
  });
  expect(tokens.primary.toLowerCase(), 'the client colour reached the page').toBe('#0060a9');
  await choice(page, 1).click();
  await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached' });
  await page.waitForTimeout(300);
  const drawn = (await readConfetti(page)).colors.map((color) => parseColor(color)!);
  expect(drawn.length).toBeGreaterThan(0);
  const allowed = buildPalette(tokens).map((hex) => parseColor(hex)!.join(','));
  expect(allowed, 'green, white, success, two tints').toHaveLength(5);
  for (const rgb of drawn) {
    expect(allowed, `drawn colour rgb(${rgb.join(', ')}) is in the palette`).toContain(rgb.join(','));
    expect(isRedish(rgb as [number, number, number]), `rgb(${rgb.join(', ')}) is not red`).toBe(false);
  }
  expect(drawn.some((rgb) => rgb.join(',') === '134,188,37'), 'Deloitte green is used').toBe(true);
  await expect(confettiCanvas(page)).toHaveCount(0, { timeout: 4000 });
});

test('prefers-reduced-motion: no confetti at all, but the sound cues still play', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Only question 3 of the first activity is left, and every other activity is done.
  await open(page, { hash: '#/quiz/section-history?t=track-a', seed: ['q-h1', 'q-h2', 'q-b1', 'q-b2', 'q-p1'] });
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
  await toggle(page).click();

  const none = async (action: () => Promise<unknown>, cue: CueName) => {
    const before = await readAudio(page);
    await action();
    await expect.poll(async () => (await readAudio(page)).oscillators.length - before.oscillators.length).toBeGreaterThanOrEqual(toneSignature(CUES[cue]).length);
    for (let waited = 0; waited < 1200; waited += 100) {
      expect(await confettiCanvas(page).count(), `no confetti after ${cue}`).toBe(0);
      await page.waitForTimeout(100);
    }
    expect((await readAudio(page)).oscillators.slice(before.oscillators.length)).toEqual(toneSignature(CUES[cue]));
  };
  await none(() => choice(page, 0).click(), 'correctFirst');
  await none(() => submit(page).click(), 'activityComplete');
  await none(() => page.getByRole('button', { name: 'Finish', exact: true }).click(), 'finale');
  await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
});

// ---- Every size at phone, iPad and desktop widths ----------------------------------------------------------------------

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }];

for (const viewport of VIEWPORTS) {
  test(`confetti at ${viewport.width}px: small, medium and large, scaled for the screen, no console errors, no sideways scroll`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    // Only question 3 of the first activity is left, and every other activity is done, so finishing it offers the finale.
    const { problems } = await open(page, { hash: '#/quiz/section-history?t=track-a', seed: ['q-h1', 'q-h2', 'q-b1', 'q-b2', 'q-p1'] });
    await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();

    const noOverflowWhile = async (size: ConfettiSize) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth);
      expect(overflow, `${size} confetti on a ${viewport.width}px screen causes no horizontal scroll`).toBe(false);
    };
    const sized = (size: ConfettiSize, action: () => Promise<unknown>) => step(page, { cue: null, confetti: size }, async () => {
      await action();
      await page.waitForSelector('canvas[data-pms-confetti]', { state: 'attached' });
      await noOverflowWhile(size);
    }, { soundOn: false });

    await sized('small', () => choice(page, 0).click());
    await sized('medium', () => submit(page).click());
    await sized('large', () => page.getByRole('button', { name: 'Finish', exact: true }).click());
    expect(problems, 'console and page errors').toEqual([]);
  });
}
