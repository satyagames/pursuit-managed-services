import { expect, test, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 16, Part 3: Results' Restart... opens its form under the row of the iPad it restarts (it opened at the foot of the page), one at a time,
// with focus on the first choice, Escape to close and focus back on the row's button. What a restart does and asks of the site is unchanged.

const PIN = '2468';

async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const session = await seedAndGoLive(fake, 'c-kroger', '2026-10-11');
  const tracks = await onSite(fake, async (ds) => {
    const made = [];
    for (let index = 0; index < 3; index += 1) made.push(await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'));
    const section = (await ds.getSection(session.sectionIds[0])) as { questionIds: string[] };
    await ds.saveParticipantResponses({ trackId: made[1].id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: section.questionIds[0], answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: '2026-10-11T10:00:00.000Z' }] });
    return made as { id: string }[];
  });
  const rows = fake.lists.get('tracks')!;
  tracks.forEach((track, index) => Object.assign(rows.find((row) => row.AppId === track.id)!, { ParticipantName: `Person ${index + 1}`, CreatedAt: `2026-10-11T09:0${index}:00.000Z` }));
  return { fake, session, tracks };
}

async function openResults(page: Page, fake: Fake, sessionId: string) {
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator(`article[data-session="${sessionId}"] .row`)).toHaveCount(3);
}
const rowNamed = (page: Page, name: string) => page.locator('article[data-session] li.row').filter({ has: page.locator('.row__title', { hasText: name }) });

test('Restart... opens its form under that iPad\'s row, takes focus, and Escape gives it back (Phase 16)', async ({ page }) => {
  const { fake, session } = await site();
  await openResults(page, fake, session.id);
  const row = rowNamed(page, 'Person 2');
  await row.getByRole('button', { name: 'Restart...' }).click();
  const form = page.locator('#restart-form');
  await expect(form).toBeVisible();
  expect(await row.evaluate((item) => item.lastElementChild?.id), 'the form is the last child of that row').toBe('restart-form');
  await expect(row.getByRole('button', { name: 'Restart...' })).toHaveAttribute('aria-expanded', 'true');
  await expect(form.getByRole('heading', { name: 'Restart Person 2' })).toBeVisible();
  await expect(form.getByRole('radio', { name: /The very beginning/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Restart...' })).toBeFocused();
  // One at a time: opening another row's form closes this one.
  await row.getByRole('button', { name: 'Restart...' }).click();
  await rowNamed(page, 'Person 1').getByRole('button', { name: 'Restart...' }).click();
  await expect(page.locator('#restart-form')).toHaveCount(1);
  expect(await rowNamed(page, 'Person 1').evaluate((item) => item.lastElementChild?.id)).toBe('restart-form');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(rowNamed(page, 'Person 1').getByRole('button', { name: 'Restart...' })).toBeFocused();
});

test('a restart from the form in the row does what it did, with the same requests, and focus comes back to the row (Phase 16)', async ({ page }) => {
  const { fake, session, tracks } = await site();
  await openResults(page, fake, session.id);
  const row = rowNamed(page, 'Person 2');
  await row.getByRole('button', { name: 'Restart...' }).click();
  await page.locator('#restart-form').getByRole('radio', { name: /The very beginning/ }).check();
  fake.reset();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByText('Person 2 restarted · 1 answers removed')).toBeVisible();
  const writes = fake.writes().map((entry) => `${entry.method} ${entry.list}`);
  // restartParticipantTrack: the answers item rewritten, then the visit stamped. Nothing else is written.
  expect(writes).toEqual(['MERGE responses', 'MERGE tracks']);
  expect(fake.item('tracks', tracks[1].id)!.RestartedAt).toBeTruthy();
  await expect(page.locator('#restart-form')).toHaveCount(0);
  await expect(rowNamed(page, 'Person 2').getByRole('button', { name: 'Restart...' })).toBeFocused();
});
