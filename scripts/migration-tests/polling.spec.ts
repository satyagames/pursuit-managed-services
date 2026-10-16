import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { advance, calls, freezeClock, gaps, holdClock, liveSite, lookTimes, looks, openVisitor, partsOf, quiet, setHidden } from './polling-support.js';

// Phase 7, polling: the BUILT participant page in SharePoint mode against the mocked REST (scripts/sharepoint-fake.js), with Playwright's
// clock in control of time, so five idle minutes take a moment and every request is counted and timed. The rules are in
// migration/src/lib/poll-schedule.js (scripts/test-polling.js holds the numbers); this holds the page to them. Not the real tenant.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const measured: Record<string, unknown> = {};
test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}polling.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

const FIVE_MINUTES = 300_000;

/** "Click here to begin" lands on the Activities hub; an activity from there is the first question. */
const toHub = async (page: Page) => {
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity').first()).toBeVisible();
};
const toQuestion = async (page: Page) => {
  await toHub(page);
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await expect(page.locator('.pms-options button').first()).toBeVisible();
};
const minutes = (count: number) => count * 60_000;

test('a page waiting on Welcome looks once every ~20 seconds, one request each: five minutes cost at most 4 requests a minute', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  await advance(page, FIVE_MINUTES);
  const sent = looks(fake);
  // ONE request each: a $batch of AppSettings, the session and the visit's own track. Nothing else is asked.
  expect(sent.every((entry) => entry.path.endsWith('/$batch')), sent.map((entry) => entry.path).join(' ')).toBe(true);
  expect(sent.every((entry) => partsOf(entry).sort().join() === ['appsettings', 'sessions', 'tracks'].sort().join())).toBe(true);
  expect(sent.length, 'one look about every 20 seconds (16 to 24)').toBeGreaterThanOrEqual(12);
  expect(sent.length).toBeLessThanOrEqual(19);
  expect(sent.length / 5, 'at most 4 requests a minute on average').toBeLessThanOrEqual(4);
  expect(fake.requests.filter((entry) => entry.faulted)).toEqual([]);
  measured.welcomeIdle5Minutes = { requests: sent.length, perMinute: sent.length / 5, parts: 3 };
});

test('the Activities hub looks the same way, with the client\'s activities in the same one request', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await toHub(page);
  await freezeClock(page, fake);
  await advance(page, FIVE_MINUTES);
  const sent = looks(fake);
  expect(sent.length).toBeGreaterThanOrEqual(12);
  expect(sent.length).toBeLessThanOrEqual(19);
  expect(sent.every((entry) => entry.path.endsWith('/$batch'))).toBe(true);
  expect(sent.every((entry) => partsOf(entry).sort().join() === ['appsettings', 'sections', 'sessions', 'tracks'].sort().join())).toBe(true);
  // The hub reads nothing of its own: no list read outside those batches.
  expect(fake.requests.filter((entry) => !entry.path.endsWith('/$batch') && !entry.path.endsWith('/contextinfo'))).toEqual([]);
  measured.hubIdle5Minutes = { requests: sent.length, perMinute: sent.length / 5, parts: 4 };
});

test('with a question on screen it looks once a minute, and sends nothing else until an answer is saved', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await toQuestion(page);
  await freezeClock(page, fake);
  await advance(page, FIVE_MINUTES);
  const sent = looks(fake);
  expect(sent.length, 'about once a minute: 48 to 72 seconds apart').toBeGreaterThanOrEqual(4);
  expect(sent.length).toBeLessThanOrEqual(6);
  expect(sent.every((entry) => entry.path.endsWith('/$batch'))).toBe(true);
  expect(sent.every((entry) => partsOf(entry).sort().join() === ['appsettings', 'sessions', 'tracks'].sort().join()), 'no activities: the hub is not open').toBe(true);
  expect(sent.length / 5, 'at most 1.2 requests a minute with a question on screen').toBeLessThanOrEqual(1.2);
  measured.questionOnScreen5Minutes = { requests: sent.length, perMinute: sent.length / 5 };
  // Answering is what costs requests then: one write, and the look still on its own clock.
  const before = fake.count();
  await page.locator('.pms-options button').nth(1).click();
  await expect.poll(() => fake.count({ method: 'POST', list: 'responses' }) + fake.count({ method: 'MERGE', list: 'responses' })).toBe(1);
  expect(fake.count() - before, 'an answer is one request (the first one also asks for its list\'s item type)').toBeLessThanOrEqual(2);
});

test('the waits are jittered: no two are the same length, they stay within 20% of 20 seconds, and they average 20', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  // One second steps would hide the jitter; a tenth of a second shows it.
  await advance(page, minutes(12), 200);
  const waits = gaps(await lookTimes(page));
  expect(waits.length).toBeGreaterThan(30);
  expect(new Set(waits.map((wait) => Math.round(wait / 100))).size, 'many different waits').toBeGreaterThan(10);
  for (const wait of waits) {
    expect(wait, `a wait of ${wait} ms`).toBeGreaterThanOrEqual(15_800);
    expect(wait).toBeLessThanOrEqual(24_500); // 24 s, and the step that carried the clock past it
  }
  const mean = waits.reduce((sum, wait) => sum + wait, 0) / waits.length;
  expect(Math.abs(mean - 20_000), `mean ${Math.round(mean)} ms`).toBeLessThan(1200);
  measured.jitter = { looks: waits.length + 1, min: Math.min(...waits), max: Math.max(...waits), mean: Math.round(mean) };
});

test('on a site that cannot batch a look is three plain reads and the wait is three times as long, so the rate is the same: still at most 4 requests a minute', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  // The site refuses every $batch (a 400 from the batch endpoint is how SharePoint says it cannot): the page reads one by one from then on.
  fake.failNext({ status: 400, times: 1000, when: (entry) => entry.path.endsWith('/$batch') });
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  await advance(page, FIVE_MINUTES);
  const sent = looks(fake);
  expect(sent.filter((entry) => entry.path.endsWith('/$batch')).length, 'it does not keep asking for a batch').toBeLessThanOrEqual(1);
  const reads = sent.filter((entry) => !entry.path.endsWith('/$batch'));
  expect(reads.map((entry) => entry.list).sort().filter((list) => ['appsettings', 'sessions', 'tracks'].includes(list!)).length).toBe(reads.length);
  expect(reads.length / 5, `${reads.length} plain reads in five minutes`).toBeLessThanOrEqual(4);
  expect(reads.length, 'about 3 reads a look, a look every ~60 s').toBeGreaterThanOrEqual(9);
  measured.noBatch5Minutes = { requests: reads.length, perMinute: reads.length / 5 };
});

test('a hidden tab sends nothing, and when it is shown again it looks once at once and carries on', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  await advance(page, 30_000); // one look has been made, so the minimum gap does not apply
  await setHidden(page, true);
  fake.reset();
  await advance(page, FIVE_MINUTES);
  expect(fake.count(), 'five minutes hidden: no request at all').toBe(0);
  await setHidden(page, false);
  await quiet(page);
  expect(looks(fake).length, 'shown again: one look, at once').toBe(1);
  expect(partsOf(looks(fake)[0]).sort()).toEqual(['appsettings', 'sessions', 'tracks']);
  // And the timer carries on from there.
  fake.reset();
  await advance(page, 60_000);
  expect(looks(fake).length).toBeGreaterThanOrEqual(2);
  expect(looks(fake).length).toBeLessThanOrEqual(4);
});

test('flipping away and back right after a look is not a second look: it waits out the minimum gap', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  await advance(page, 30_000);
  await setHidden(page, true);
  await advance(page, 60_000);
  await setHidden(page, false); // the look that a returning tab makes
  await quiet(page);
  fake.reset();
  await setHidden(page, true);
  await setHidden(page, false);
  await quiet(page);
  expect(looks(fake).length, 'a quick flip does not look again straight away').toBe(0);
  await advance(page, 6_000);
  expect(looks(fake).length, 'it looks once the gap has passed (and that is the one look)').toBe(1);
});

test('the network coming back is looked at straight away, even soon after the last look', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await quiet(page);
  expect(looks(fake).length).toBe(1);
});

for (const status of [429, 503]) {
  test(`a ${status} with Retry-After is honoured: no look sooner than it asks, then one more try, then it carries on`, async ({ page }) => {
    const { fake, codes } = await liveSite(1);
    await openVisitor(page, fake, codes[0]);
    await freezeClock(page, fake);
    // The first look in this window is refused and asks for 90 seconds.
    fake.failNext({ status, retryAfter: 90, when: (entry) => entry.path.endsWith('/$batch') });
    await advance(page, 30_000);
    const refused = fake.requests.filter((entry) => entry.faulted);
    expect(refused.length, 'one request was refused').toBe(1);
    const refusedAt = (await lookTimes(page)).at(-1)!;
    fake.reset();
    const sinceRefusal = async () => (await page.evaluate(() => Date.now())) - refusedAt;
    await advance(page, 85_000 - (await sinceRefusal()));
    expect(fake.count(), 'nothing for the 90 seconds it asked (85 so far)').toBe(0);
    await advance(page, 25_000);
    expect(looks(fake).length, 'then one try').toBeGreaterThanOrEqual(1);
    const times = await lookTimes(page);
    const next = times.find((time) => time > refusedAt)!;
    expect(next - refusedAt, `the next look came ${next - refusedAt} ms after the refusal`).toBeGreaterThanOrEqual(90_000);
    expect(next - refusedAt).toBeLessThanOrEqual(90_000 * 1.2 + 2000);
    // It was not retried in a burst, and nothing the page showed broke: no "can't reach the server" banner.
    await expect(page.getByText('Can’t reach the server. Reconnecting…')).toHaveCount(0);
    measured[`busy${status}`] = { askedMs: 90_000, nextLookAfterMs: next - refusedAt };
  });
}

test('without a Retry-After a failing page backs off: each failure doubles the wait, up to five minutes, and one good look resets it', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  fake.failNext({ status: 503, times: 3, when: (entry) => entry.path.endsWith('/$batch') });
  await advance(page, minutes(8), 500);
  const times = await lookTimes(page);
  const waits = gaps(times);
  // 20 s (first look, refused), then ~40 s, ~80 s (both refused), then ~160 s (good), then back to ~20 s.
  expect(waits[0]).toBeGreaterThanOrEqual(31_000);
  expect(waits[0]).toBeLessThanOrEqual(49_000);
  expect(waits[1]).toBeGreaterThanOrEqual(63_000);
  expect(waits[1]).toBeLessThanOrEqual(98_000);
  const good = waits.findIndex((wait, index) => index >= 2 && wait < 30_000);
  expect(good, 'after a good look the waits are 20 seconds again').toBeGreaterThan(1);
  measured.backoff = { waits: waits.map((wait) => Math.round(wait / 1000)) };
});

test('when a question closes the page looks soon (if a while has passed), when one opens it waits the longer time', async ({ page }) => {
  const { fake, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await toQuestion(page);
  await freezeClock(page, fake);
  await advance(page, 40_000); // a question on screen: no look yet, or one at most
  const during = looks(fake).length;
  expect(during).toBeLessThanOrEqual(1);
  // Home from the question: the screen is "waiting" again, so a look is due within the minimum gap.
  fake.reset();
  await page.getByRole('button', { name: 'Home' }).click();
  await advance(page, 6_000);
  expect(looks(fake).length, 'a look soon after leaving the question').toBeGreaterThanOrEqual(1);
});

test('ten iPads on one account, idle for five minutes: under 10% of the 3,000 requests SharePoint allows it', async ({ browser }) => {
  test.setTimeout(240_000);
  const { fake, codes } = await liveSite(10);
  const pages = await openMany(browser, fake, codes);
  for (const page of pages) await quiet(page);
  // Counting starts once every device is up and its clock is held.
  for (const page of pages) await holdClock(page);
  for (const page of pages) await quiet(page);
  fake.reset();
  for (const page of pages) await page.evaluate(() => { (window as unknown as { __net: { calls: unknown[] } }).__net.calls.length = 0; });
  // Five minutes, all ten together, two seconds at a time.
  for (let done = 0; done < FIVE_MINUTES; done += 2000) {
    for (const page of pages) await page.clock.runFor(2000);
    for (const page of pages) await quiet(page);
  }
  const total = fake.count();
  const perDevice = await Promise.all(pages.map(async (page) => (await calls(page)).filter((call) => call.url.endsWith('/$batch')).length));
  expect(total, `${total} requests from ten idle devices in five minutes`).toBeLessThan(0.1 * 3000);
  expect(Math.max(...perDevice) / 5, 'no device made more than 4 requests a minute').toBeLessThanOrEqual(4);
  // They are not in step: the looks of the ten fall at many different moments.
  const moments = (await Promise.all(pages.map((page) => lookTimes(page)))).flat();
  expect(new Set(moments.map((moment) => Math.round(moment / 1000))).size, 'spread over many seconds').toBeGreaterThan(60);
  expect(fake.requests.filter((entry) => entry.faulted)).toEqual([]);
  measured.tenDevices5Minutes = { requests: total, percentOf3000: Number(((total / 3000) * 100).toFixed(1)), perDevice };
  await Promise.all(pages.map((page) => page.context().close()));
});

async function openMany(browser: Browser, fake: Awaited<ReturnType<typeof liveSite>>['fake'], codes: string[]) {
  const pages = [];
  for (const code of codes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openVisitor(page, fake, code);
    pages.push(page);
  }
  return pages;
}
