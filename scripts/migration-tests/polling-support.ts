import { expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// What the polling and end-session specs share: a participant page in SharePoint mode (the BUILT page against the mocked REST), with
// Playwright's clock in control of time, so that five minutes of a page sitting idle take a moment and every request can be counted
// and timed. The times are the PAGE's clock (the fake's own log is in real time, which a jump in the page's clock does not move).

export const T0 = new Date('2026-10-11T09:00:00.000Z');

export type Call = { at: number; method: string; url: string };

/** Records every fetch the page makes (in the page's clock) and how many are still in flight. Call before the first goto(). */
export async function recordFetches(page: Page) {
  await page.addInitScript(() => {
    const state = { inflight: 0, calls: [] as { at: number; method: string; url: string }[] };
    (window as unknown as { __net: typeof state }).__net = state;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      state.calls.push({ at: Date.now(), method: (init?.method ?? 'GET').toUpperCase(), url });
      state.inflight += 1;
      try { return await real(input, init); } finally { state.inflight -= 1; }
    };
  });
}

export const calls = (page: Page) => page.evaluate(() => (window as unknown as { __net: { calls: Call[] } }).__net.calls);
export const inflight = (page: Page) => page.evaluate(() => (window as unknown as { __net: { inflight: number } }).__net.inflight);
/** Resolves once nothing the page asked for is still on its way. */
export const quiet = (page: Page) => expect.poll(() => inflight(page), { timeout: 10_000 }).toBe(0);

/** Moves the page's clock on by `ms`, `step` at a time, letting what the page asked for arrive before the next step. */
export async function advance(page: Page, ms: number, step = 1000) {
  for (let done = 0; done < ms; done += step) {
    await page.clock.runFor(Math.min(step, ms - done));
    await quiet(page);
  }
}

/** Takes control of the page's clock: call before goto(), then `settleClock` once the page has booted. */
export async function takeClock(page: Page) {
  await page.clock.install({ time: T0 });
}

/** Stops the page's clock half a second from now: from here on, time moves only when the test says so. */
export async function holdClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 500));
}

/** Freezes the page's clock a little after its boot, so counting starts from a known moment (the first look is still ahead). */
export async function freezeClock(page: Page, fake: Fake) {
  await quiet(page);
  await holdClock(page);
  await quiet(page);
  fake.reset();
  await page.evaluate(() => { (window as unknown as { __net: { calls: Call[] } }).__net.calls.length = 0; });
}

/** A tab that is hidden (or shown again): what a browser does when the person switches away, as far as the page can tell. */
export async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** The requests the fake saw, without the one-off write token, as a short word each. */
export const looks = (fake: Fake) => fake.requests.filter((entry) => !entry.path.endsWith('/contextinfo'));
export const partsOf = (entry: Fake['requests'][number]) => (entry.parts ?? [entry]).map((part) => part.list);

/** The page's own times between the looks it made: `POST $batch` (or a plain read of AppSettings) in the page's clock. */
export async function lookTimes(page: Page) {
  return (await calls(page)).filter((call) => call.url.endsWith('/$batch') || new RegExp(`${TITLE.appsettings}`).test(decodeURIComponent(call.url))).map((call) => call.at);
}

export const gaps = (times: number[]) => times.slice(1).map((time, index) => time - times[index]);

/** A site with the sample clients, Kroger live today, and a visitor code for each of `count` people (guest mode). */
export async function liveSite(count = 1, options: { names?: string[] } = {}) {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger', '2026-10-11');
  const codes = await onSite(fake, async (ds) => {
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const made: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const visitor = await ds.createVisitor({ sessionId: session.id, displayName: options.names?.[index] ?? `Guest ${index + 1}`, enabled: true });
      made.push((await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id })).id as string);
    }
    return made;
  });
  return { fake, session, codes };
}

/** Opens the participant page with a visitor's code (so it has a visit of its own) with the page's clock held by the test. */
export async function openVisitor(page: Page, fake: Fake, code: string, route = '') {
  await serveSharePoint(page, fake);
  await recordFetches(page);
  await takeClock(page);
  await page.goto(`${pageUrl('index.html')}?qr=${code}${route}`);
  await expect(page.getByRole('button', { name: /Click here to begin|Activities/ })).toBeVisible();
}

export const trackOf = (fake: Fake) => fake.lists.get('tracks')!.map((row) => String(row.AppId));
