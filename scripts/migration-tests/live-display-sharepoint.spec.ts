import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { resultsToCsv } from '../../migration/src/lib/exports/resultsExport.js';
import { readSessionResults } from '../../migration/src/lib/results/session-results.js';
import { advance, calls, freezeClock, gaps, lookTimes, looks, partsOf, quiet, recordFetches, setHidden, takeClock } from './polling-support.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, shape, type Fake } from './sharepoint.js';

// Phase 7: the facilitator's Live display, the Results tab and the other admin polls on SharePoint, measured in a real browser: the BUILT admin page
// served at the approved host's address against the mocked REST (scripts/sharepoint-fake.js, which counts every request), with Playwright's clock in
// control of time. What it costs to open, to keep open for five minutes (with the tab shown and hidden), how it backs off, and that the exports are
// the same files. Not the real tenant. The numbers are written to test-results/budget/live-display-sharepoint.json.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const measured: Record<string, unknown> = {};
test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}live-display-sharepoint.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

const PIN = '2468';
const FIVE_MINUTES = 300_000;
const DAY = '2026-10-11';

/** A site with an admin, Kroger live, and three iPads that answered. */
async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const session = await seedAndGoLive(fake, 'c-kroger', DAY);
  await onSite(fake, async (ds) => {
    const tracks = [];
    for (let index = 0; index < 3; index += 1) tracks.push(await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'));
    const give = (trackId: string, picks: Record<string, string>) => ds.saveParticipantResponses({
      trackId, sessionId: session.id, clientId: 'c-kroger',
      responses: Object.entries(picks).map(([questionId, answer]) => ({ questionId, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' })),
    });
    await give(tracks[0].id, { 'q-trivia-1': 'o-trivia-1-b', 'q-trivia-2': 'o-trivia-2-a' });
    await give(tracks[1].id, { 'q-trivia-1': 'o-trivia-1-b' });
    await give(tracks[2].id, { 'q-trivia-1': 'o-trivia-1-a' });
  });
  return { fake, session };
}

/** The admin page with the page's clock held by the test; unlocks and lands where the address says. */
async function openAdmin(page: Page, fake: Fake, hash = '') {
  const served = await serveSharePoint(page, fake);
  await recordFetches(page);
  await takeClock(page);
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  return served;
}

const meta = (page: Page) => page.locator('.live__meta');
/** What an admin page that has been left open for five minutes sent, and how often. */
async function fiveMinutes(page: Page, fake: Fake) {
  await freezeClock(page, fake);
  await advance(page, FIVE_MINUTES);
  return looks(fake);
}

test('opening the Live display: the structure in 3 requests and the first feed in 1, from the PIN 6 in all', async ({ page }) => {
  const { fake, session } = await site();
  const served = await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  fake.reset();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);
  await expect(page.locator('.result-card').first()).toBeVisible();
  const sent = fake.requests.map(shape);
  expect(sent.length, sent.join(' | ')).toBeLessThanOrEqual(7);
  // The PIN check, the write token the batches need, the session, then ONE batch each for the activities with the client, for the questions with the
  // options, and for the first feed (the session, its tracks, every answer, its activities).
  expect(sent.filter((entry) => entry === 'GET adminusers').length).toBe(1);
  const batches = fake.requests.filter((entry) => entry.path.endsWith('/$batch'));
  expect(batches.length).toBe(3);
  expect(partsOf(batches[0]).sort()).toEqual(['clients', 'sections']);
  expect(partsOf(batches[1]).every((list) => list === 'questions' || list === 'options')).toBe(true);
  expect(partsOf(batches[2]).sort()).toEqual(['responses', 'sections', 'sessions', 'tracks']);
  expect(served.unexpected).toEqual([]);
  measured.opening = { requestsFromPin: sent.length, requests: sent };
});

test('left open for five minutes it makes one request every 12 seconds: under 6 a minute with the structure read at the end, none while the tab is hidden', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, `#live-display/${session.id}`);
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);
  const sent = await fiveMinutes(page, fake);
  // Every refresh is ONE batch of the same four reads; the structure (3 requests) is read again once, at five minutes.
  const feeds = sent.filter((entry) => partsOf(entry).sort().join() === ['responses', 'sections', 'sessions', 'tracks'].sort().join());
  expect(feeds.length, 'a refresh every 12 s: 24 to 25 in 5 minutes').toBeGreaterThanOrEqual(24);
  expect(feeds.length).toBeLessThanOrEqual(26);
  const rest = sent.filter((entry) => !feeds.includes(entry));
  expect(rest.length, 'the structure, once: a session, a batch of activities and client, a batch of questions and options').toBeLessThanOrEqual(3);
  expect(sent.length / 5, `${sent.length} requests in five minutes`).toBeLessThan(6);
  measured.liveDisplay5Minutes = { requests: sent.length, perMinute: Number((sent.length / 5).toFixed(2)), refreshes: feeds.length, structureReads: rest.length };

  // A hidden tab sends nothing; shown again, it refreshes once at once.
  await setHidden(page, true);
  fake.reset();
  await advance(page, FIVE_MINUTES);
  expect(fake.count(), 'five minutes hidden').toBe(0);
  await setHidden(page, false);
  await quiet(page);
  expect(looks(fake).length, 'shown again: one refresh').toBe(1);
  expect(partsOf(looks(fake)[0]).sort()).toEqual(['responses', 'sections', 'sessions', 'tracks']);
});

test('a refresh that is answered 429 or 503 backs off for as long as Retry-After asks, and the display keeps showing what it had', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, `#live-display/${session.id}`);
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);
  await freezeClock(page, fake);
  fake.failNext({ status: 429, retryAfter: 70, when: (entry) => entry.path.endsWith('/$batch') });
  await advance(page, 20_000);
  expect(fake.requests.filter((entry) => entry.faulted).length).toBe(1);
  const refusedAt = (await lookTimes(page)).length ? (await calls(page)).filter((call) => call.url.endsWith('/$batch')).at(-1)!.at : 0;
  const since = async () => (await page.evaluate(() => Date.now())) - refusedAt;
  fake.reset();
  await advance(page, 65_000 - (await since()));
  expect(fake.count(), 'nothing for the 70 seconds it asked').toBe(0);
  await expect(meta(page)).toContainText(/Connection lost\. Retrying\.\.\.|4 answers from 3 iPads/);
  await advance(page, 20_000);
  const next = (await calls(page)).filter((call) => call.url.endsWith('/$batch') && call.at > refusedAt)[0];
  expect(next.at - refusedAt, 'the next refresh came after the 70 seconds').toBeGreaterThanOrEqual(70_000);
  expect(next.at - refusedAt).toBeLessThanOrEqual(85_000);
  await expect(page.locator('.result-card').first()).toBeVisible();
  measured.liveDisplayBusy = { askedMs: 70_000, nextAfterMs: next.at - refusedAt };
});

test('the display follows answers: a new one moves the tally on the next refresh, in the one request', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, `#live-display/${session.id}`);
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);
  await freezeClock(page, fake);
  await onSite(fake, async (ds) => {
    const [track] = await ds.listClientTracks(session.id);
    await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: ['q-trivia-1', 'q-trivia-2', 'q-trivia-3'].map((questionId) => ({ questionId, answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: null, answeredAt: '2026-10-11T12:05:00.000Z' })) });
  });
  fake.reset();
  await advance(page, 13_000);
  await expect(meta(page)).toContainText(/5 answers from 3 iPads/);
  expect(looks(fake).length).toBe(1);
});

test('the exports from the admin page are the same files on SharePoint: CSV byte for byte, PDF, and PowerPoint, branded with the session\'s client', async ({ page }) => {
  const { fake, session } = await site();
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);

  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const text = (await readFile((await (await csv).path())!, 'utf8')).replace(/^﻿/, '');
  // Phase 13: the summary by activity, with the client's name (the one the display shows) in every row; shares as whole numbers.
  const client = (await page.locator('.live__client').innerText()).trim();
  const expected = await onSite(fake, async () => resultsToCsv(await readSessionResults(session.id), { name: client }));
  expect(text).toBe(expected);
  expect(text).toContain('Great Western Tea co.,2,67,');
  expect(text, 'the third iPad\'s answer is counted').toContain('Kroger grocery and Baking co.,1,33,');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const pdfBytes = await readFile((await (await pdf).path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes.toString('latin1')).toContain('/Creator (Pursuit Managed Services)');
  expect(pdfBytes.toString('latin1')).toContain('Kroger');

  const ppt = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PPT' }).click();
  const archive = await JSZip.loadAsync(await readFile((await (await ppt).path())!));
  expect(await archive.file('ppt/slides/slide1.xml')!.async('string')).toContain('Kroger');
  expect(await archive.file('docProps/app.xml')!.async('string')).toContain('<Company>Pursuit Managed Services</Company>');
  // And every answer it counted was read through the one reader: one indexed query of the session's Responses, never a read of a track's own item.
  expect(fake.requests.filter((entry) => entry.list === 'responses' && /TrackId eq/.test(entry.query)).length).toBe(0);
});

test('Results keeps only the live session fresh: one request every 15 seconds on SharePoint, and Refresh reads every session again', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, '#results');
  await expect(page.locator(`article[data-session="${session.id}"]`)).toBeVisible();
  const sent = await fiveMinutes(page, fake);
  // The live session is refreshed with the same one-request feed as the Live display, every 15 s (20 in five minutes), and its structure is read
  // again once at five minutes (3 requests). Nothing else, and the other sessions are not read at all.
  const feeds = sent.filter((entry) => entry.path.endsWith('/$batch') && partsOf(entry).sort().join() === ['responses', 'sections', 'sessions', 'tracks'].sort().join());
  expect(feeds.length, `${sent.length} requests in five minutes`).toBeGreaterThanOrEqual(19);
  expect(feeds.length).toBeLessThanOrEqual(21);
  // Nothing else but the structure, once (3 requests), and ONE more look for the names of the three iPads that have none (Phase 7c: Results names people by
  // the leader report's rule, so a visit with no name of its own is looked for in the visit log and the roster; at the first refresh, once more).
  expect(sent.length - feeds.length, 'the structure once, and one look for the names').toBeLessThanOrEqual(4);
  expect(sent.filter((entry) => partsOf(entry).sort().join() === ['uservisitlogs', 'visitorroster'].join()).length, 'one look for names').toBe(1);
  expect(sent.length / 5).toBeLessThanOrEqual(5);
  measured.results5Minutes = { requests: sent.length, perMinute: Number((sent.length / 5).toFixed(2)) };
  // Refresh reads every session in full once.
  fake.reset();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await quiet(page);
  expect(fake.count()).toBeGreaterThan(3);
  measured.resultsRefreshButton = { requests: fake.count() };
});

test('Results names people by the leader report\'s rule, and looks once more for a sign-in that is written a moment after somebody joins', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, '#results');
  const card = page.locator(`article[data-session="${session.id}"]`);
  const titles = card.locator('.row__title');
  // The three iPads have no name anywhere: "Unnamed participant N", never the client's name and never "Visit 1".
  await expect(titles).toHaveText(['Unnamed participant 1', 'Unnamed participant 2', 'Unnamed participant 3']);
  await freezeClock(page, fake);
  const namesReads = () => looks(fake).filter((entry) => partsOf(entry).sort().join() === ['uservisitlogs', 'visitorroster'].join()).length;
  const feeds = () => looks(fake).filter((entry) => partsOf(entry).sort().join() === ['responses', 'sections', 'sessions', 'tracks'].sort().join()).length;

  // A member of staff joins on a fourth iPad. The participant page writes its sign-in a moment after its first screen, so the track comes first.
  await onSite(fake, (ds) => ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger', { sharePointUserId: '17' }));
  fake.reset();
  await advance(page, 16_000);
  await expect(titles).toHaveText(['Unnamed participant 1', 'Unnamed participant 2', 'Unnamed participant 3', 'Unnamed participant 4']);
  expect(feeds(), 'the refresh').toBe(1);
  expect(namesReads(), 'and one look for the new person\'s name, which is not written yet').toBe(1);

  await onSite(fake, (ds) => ds.recordUserVisit({
    visitKey: 'visit-staff-17', sessionId: session.id, clientId: 'c-kroger', page: 'participant', entryMode: 'staff', sharePointUserId: '17', displayName: 'Priya Shah', visitorId: null, visitorName: '', trackId: null, visitedAt: new Date().toISOString(),
  }));
  fake.reset();
  await advance(page, 15_000);
  await expect(titles).toHaveText(['Unnamed participant 1', 'Unnamed participant 2', 'Unnamed participant 3', 'Priya Shah']);
  expect(namesReads(), 'the second look finds it').toBe(1);

  // And then it stops looking: nobody else is new, so a refresh is the feed alone.
  fake.reset();
  await advance(page, 45_000);
  expect(feeds()).toBeGreaterThanOrEqual(2);
  expect(namesReads(), 'no more looks').toBe(0);
  measured.resultsNameLooks = { looksForTheNewPerson: 2, looksAfterwards: 0 };
});

test('every other admin screen, left open for five minutes on SharePoint: Today 6 a minute, Content 4, Guests and QR 4 to 8', async ({ page }) => {
  const { fake } = await site();
  const rates: Record<string, number> = {};
  for (const [tab, name] of [['today', 'Today'], ['content', 'Content'], ['guests', 'Guests and QR']] as const) {
    const fresh = await page.context().newPage();
    await openAdmin(fresh, fake, `#${tab}`);
    await expect(fresh.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await quiet(fresh);
    await fresh.waitForTimeout(500);
    const sent = await fiveMinutes(fresh, fake);
    rates[name] = Number((sent.length / 5).toFixed(2));
    expect(sent.every((entry) => entry.path.endsWith('/$batch') || entry.method === 'GET'), `${name}: reads only`).toBe(true);
    await fresh.close();
  }
  expect(rates.Today, 'Today: at most 6 a minute').toBeLessThanOrEqual(6.2);
  expect(rates.Content).toBeLessThanOrEqual(4.2);
  expect(rates['Guests and QR']).toBeLessThanOrEqual(8.2);
  measured.otherAdminScreens = rates;
});

test('jitter is not applied to the admin\'s polls: they are regular, one facilitator on one page', async ({ page }) => {
  const { fake, session } = await site();
  await openAdmin(page, fake, `#live-display/${session.id}`);
  await expect(meta(page)).toContainText(/4 answers from 3 iPads/);
  await freezeClock(page, fake);
  await advance(page, 120_000, 500);
  const waits = gaps(await lookTimes(page));
  for (const wait of waits) expect(Math.abs(wait - 12_000)).toBeLessThan(700);
});
