import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 16, Part 1, in the BUILT admin page against the mocked SharePoint REST: Results shows the newest session first, the newest joiner
// first inside a card, and a refresh keeps the cards where they are. The rule itself is scripts/test-admin-results.js.

const PIN = '2468';
/** A question of Domino's live activities, answered by both visits. */
let QUESTION = '';
const card = (page: Page, sessionId: string) => page.locator(`article[data-session="${sessionId}"]`);
const cardIds = (page: Page) => page.locator('article[data-session]').evaluateAll((cards) => cards.map((element) => element.getAttribute('data-session')));

/** Three sessions on three days, made oldest last so the list order is not the date order: Kroger 10-01, Domino's 10-15 (live), Kroger 10-09. */
async function threeDays() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const people = await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    await ds.activateClient('c-kroger', '2026-10-09');
    await ds.activateClient('c-kroger', '2026-10-01');
    const live = (await ds.activateClient('c-dominos', '2026-10-15')).session as { id: string; sectionIds: string[] };
    QUESTION = ((await ds.getSection(live.sectionIds[0])) as { questionIds: string[] }).questionIds[0];
    const first = await ds.beginVisit(crypto.randomUUID(), live.id, 'c-dominos');
    const second = await ds.beginVisit(crypto.randomUUID(), live.id, 'c-dominos');
    for (const track of [first, second]) {
      await ds.saveParticipantResponses({ trackId: track.id, sessionId: live.id, clientId: 'c-dominos', responses: [{ questionId: QUESTION, answer: 'yes', firstAnswer: 'yes', attempts: 1, correct: null, answeredAt: '2026-10-15T09:05:00.000Z' }] });
    }
    return { live: live.id, first: first.id as string, second: second.id as string };
  });
  // The two visits a minute apart, with names, so the rows can be told apart.
  const tracks = fake.lists.get('tracks')!;
  Object.assign(tracks.find((row) => row.AppId === people.first)!, { ParticipantName: 'Early Arrival', CreatedAt: '2026-10-15T09:00:00.000Z' });
  Object.assign(tracks.find((row) => row.AppId === people.second)!, { ParticipantName: 'Just Arrived', CreatedAt: '2026-10-15T09:01:00.000Z' });
  return { fake, ...people };
}

async function openResults(page: Page, fake: Fake) {
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('Results shows the newest session first, the newest joiner first, and Refresh keeps the order (Phase 16)', async ({ page }) => {
  const { fake, live } = await threeDays();
  expect(fake.lists.get('sessions')!.map((row) => row.AppId), 'the list holds them oldest last').toEqual(['kroger-2026-10-09', 'kroger-2026-10-01', 'dominos-2026-10-15']);
  await openResults(page, fake);
  await expect(card(page, live)).toBeVisible();
  await expect.poll(() => cardIds(page)).toEqual(['dominos-2026-10-15', 'kroger-2026-10-09', 'kroger-2026-10-01']);
  await expect(card(page, live).locator('.row .row__title')).toHaveText(['Just Arrived', 'Early Arrival']);

  // Open the live card's results, then Refresh: the order, the open panel and the scroll stay.
  await card(page, live).locator('summary').click();
  await expect(card(page, live).locator('details.tally')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/^Updated /)).toBeVisible();
  expect(await cardIds(page)).toEqual(['dominos-2026-10-15', 'kroger-2026-10-09', 'kroger-2026-10-01']);
  await expect(card(page, live).locator('details.tally')).toHaveAttribute('open', '');
});

test('a visit to an older session does not move it above a newer one, and the exports keep their own order (Phase 16)', async ({ page }) => {
  const { fake, live } = await threeDays();
  // A late visit to the 10-01 session: its date still puts it last.
  await onSite(fake, (ds) => ds.beginVisit(crypto.randomUUID(), 'kroger-2026-10-01', 'c-kroger'));
  await openResults(page, fake);
  await expect(card(page, live)).toBeVisible();
  await expect.poll(() => cardIds(page)).toEqual(['dominos-2026-10-15', 'kroger-2026-10-09', 'kroger-2026-10-01']);
  // "All answers (CSV)" lists the people in the order they joined, as before Phase 16: the screen's order is the screen's only.
  const [file] = await Promise.all([page.waitForEvent('download'), card(page, live).getByRole('button', { name: 'All answers (CSV)' }).click()]);
  const text = await readFile((await file.path())!, 'utf8');
  expect(text).toContain('Early Arrival');
  expect(text.indexOf('Early Arrival')).toBeLessThan(text.indexOf('Just Arrived'));
});
