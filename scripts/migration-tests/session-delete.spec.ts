import { expect, test, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { DELETE_SESSION, SESSION_OWNED, deleteSessionWarning } from '../../migration/src/lib/admin/session-delete.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { axeCheck, describeFindings } from './a11y-support.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 16, Part 2, in the BUILT admin page against the mocked SharePoint REST (scripts/sharepoint-fake.js; not the real tenant): "Delete session..."
// on a Results card opens a warning, and only its "Delete permanently" deletes, once. The rules are scripts/test-session-delete.js.

const PIN = '2468';
const OLD = 'kroger-2026-10-09';
const LIVE = 'dominos-2026-10-15';
const card = (page: Page, sessionId: string) => page.locator(`article[data-session="${sessionId}"]`);
const cardIds = (page: Page) => page.locator('article[data-session]').evaluateAll((cards) => cards.map((element) => element.getAttribute('data-session')));
/** Every item keyed by a session, list by list. */
const holding = (fake: Fake, sessionId: string) => Object.fromEntries(SESSION_OWNED.map(({ list, key }) => [list, fake.lists.get(list)!.filter((row) => (key === 'id' ? row.AppId : row.SessionId) === sessionId).length]));

/** Kroger on 10-09 (ended; two iPads, one with two answers, a guest code) and Kroger on 10-01 (one iPad); Domino's live on 10-15 with one iPad. */
async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const made = await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    await ds.activateClient('c-kroger', '2026-10-01');
    await ds.beginVisit(crypto.randomUUID(), 'kroger-2026-10-01', 'c-kroger');
    const old = (await ds.activateClient('c-kroger', '2026-10-09')).session as { id: string; sectionIds: string[] };
    const tracks = [await ds.beginVisit(crypto.randomUUID(), old.id, 'c-kroger'), await ds.beginVisit(crypto.randomUUID(), old.id, 'c-kroger')];
    const section = (await ds.getSection(old.sectionIds[0])) as { questionIds: string[] };
    await ds.saveParticipantResponses({ trackId: tracks[0].id, sessionId: old.id, clientId: 'c-kroger', responses: section.questionIds.slice(0, 2).map((questionId) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: '2026-10-09T10:00:00.000Z' })) });
    const code = await ds.provisionQrToken('c-kroger', old.id);
    await ds.endSession(old.id);
    await ds.activateClient('c-dominos', '2026-10-15');
    await ds.beginVisit(crypto.randomUUID(), LIVE, 'c-dominos');
    return { tracks, code, questionId: section.questionIds[2] };
  });
  return { fake, ...made };
}

async function openResults(page: Page, fake: Fake) {
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(card(page, LIVE)).toBeVisible();
}
const dialog = (page: Page) => page.getByRole('dialog', { name: DELETE_SESSION.title });

test('Delete session... is on every card; opening the warning writes nothing; Cancel and Escape delete nothing (Phase 16)', async ({ page }) => {
  const { fake } = await site();
  await openResults(page, fake);
  for (const id of await cardIds(page)) await expect(card(page, id!).getByRole('button', { name: DELETE_SESSION.button })).toBeVisible();
  // It is in the card's head, after Live display, and not among the export buttons.
  await expect(card(page, OLD).locator('.card__head button')).toHaveText(['Live display', DELETE_SESSION.button]);
  await expect(card(page, OLD).locator('.report-exports').getByRole('button', { name: DELETE_SESSION.button })).toHaveCount(0);

  const writes = fake.writes().length;
  const before = holding(fake, OLD);
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(deleteSessionWarning({ clientName: 'Kroger', date: '2026-10-09', status: 'completed' }, { ipads: 2, answers: 2, codes: 1 }).lead);
  await expect(dialog(page)).toContainText('The client, its activities and questions are kept.');
  await expect(dialog(page).getByRole('button', { name: 'Leader report (PDF)' }), 'the report can be kept first').toBeVisible();
  await expect(dialog(page).getByRole('button', { name: DELETE_SESSION.cancel })).toBeFocused();
  // Enter on the default button cancels.
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }), 'focus returns to its Delete button').toBeFocused();
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await dialog(page).getByRole('button', { name: DELETE_SESSION.cancel }).click();
  expect(fake.writes().length, 'nothing was written').toBe(writes);
  expect(holding(fake, OLD)).toEqual(before);
});

test('only "Delete permanently" deletes, once even on a double click; only that card goes, the others keep their place and open panels (Phase 16)', async ({ page }) => {
  const { fake } = await site();
  await openResults(page, fake);
  await card(page, LIVE).locator('summary').click();
  await expect(card(page, LIVE).locator('details.tally')).toHaveAttribute('open', '');
  const order = await cardIds(page);
  const others = { live: holding(fake, LIVE), first: holding(fake, 'kroger-2026-10-01') };
  const owned = holding(fake, OLD);
  const writesBefore = fake.writes().length;
  const content = ['clients', 'sections', 'questions', 'options', 'adminusers', 'appsettings'].map((list) => JSON.stringify(fake.lists.get(list)));

  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await dialog(page).getByRole('button', { name: DELETE_SESSION.confirm }).dblclick();
  await expect(page.getByText('Kroger 2026-10-09 deleted')).toBeVisible();
  await expect(card(page, OLD)).toHaveCount(0);
  expect(holding(fake, OLD)).toEqual(Object.fromEntries(SESSION_OWNED.map(({ list }) => [list, 0])));
  // Each item was deleted once: a second press sent nothing.
  const deletes = fake.writes().slice(writesBefore);
  expect(deletes.every((entry) => SESSION_OWNED.some(({ list }) => list === entry.list)), 'only the lists a session owns were written to').toBe(true);
  expect(deletes.length).toBe(Object.values(owned).reduce((sum, count) => sum + count, 0));
  expect(await cardIds(page)).toEqual(order.filter((id) => id !== OLD));
  await expect(card(page, LIVE).locator('details.tally')).toHaveAttribute('open', '');
  expect(holding(fake, LIVE)).toEqual(others.live);
  expect(holding(fake, 'kroger-2026-10-01')).toEqual(others.first);
  expect(['clients', 'sections', 'questions', 'options', 'adminusers', 'appsettings'].map((list) => JSON.stringify(fake.lists.get(list)))).toEqual(content);
  // Focus is on the next card's title.
  await expect(card(page, 'kroger-2026-10-01').locator('[data-card-title]')).toBeFocused();
});

test('the live session is refused in words, and nothing is deleted (Phase 16)', async ({ page }) => {
  const { fake } = await site();
  await openResults(page, fake);
  const before = holding(fake, LIVE);
  await card(page, LIVE).getByRole('button', { name: DELETE_SESSION.button }).click();
  await dialog(page).getByRole('button', { name: DELETE_SESSION.confirm }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText(DELETE_SESSION.live);
  expect(holding(fake, LIVE)).toEqual(before);
  await dialog(page).getByRole('button', { name: DELETE_SESSION.cancel }).click();
  await expect(card(page, LIVE)).toBeVisible();
});

test('an answer that arrives while the warning is open is said, with the new numbers, and the person presses again (Phase 16)', async ({ page }) => {
  const { fake, tracks, questionId } = await site();
  await openResults(page, fake);
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await expect(dialog(page)).toContainText('2 iPads, 2 answers, 1 guest code');
  await onSite(fake, (ds) => ds.saveParticipantResponses({ trackId: tracks[1].id, sessionId: OLD, clientId: 'c-kroger', responses: [{ questionId, answer: 'y', firstAnswer: 'y', attempts: 1, correct: null, answeredAt: '2026-10-09T11:00:00.000Z' }] }));
  await dialog(page).getByRole('button', { name: DELETE_SESSION.confirm }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Something changed while this was open: there are now 2 iPads, 3 answers, 1 guest code.');
  await expect(dialog(page)).toContainText('2 iPads, 3 answers, 1 guest code. This is permanent');
  expect(holding(fake, OLD).sessions).toBe(1);
  await dialog(page).getByRole('button', { name: DELETE_SESSION.confirm }).click();
  await expect(card(page, OLD)).toHaveCount(0);
});

test('a refused delete (403) says what is missing in words; the card stays and Try again removes what is left (Phase 16)', async ({ page }) => {
  const { fake } = await site();
  await openResults(page, fake);
  fake.forbid((entry) => entry.list === 'tracks');
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await dialog(page).getByRole('button', { name: DELETE_SESSION.confirm }).click();
  await expect(dialog(page).getByRole('alert')).toContainText(`Your account may not delete items in ${fake.titleOf('tracks')}`);
  await expect(dialog(page).getByRole('button', { name: DELETE_SESSION.retry })).toBeVisible();
  expect(holding(fake, OLD).sessions, 'the session stays on Results').toBe(1);
  expect(holding(fake, OLD).responses, 'what came first went').toBe(0);
  fake.clearFaults();
  await dialog(page).getByRole('button', { name: DELETE_SESSION.retry }).click();
  await expect(card(page, OLD)).toHaveCount(0);
  expect(holding(fake, OLD).sessions).toBe(0);
});

test('the warning passes axe, keeps focus inside, and its buttons have names (Phase 16)', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium', 'axe-core reads the DOM, which is the same in every engine');
  const { fake } = await site();
  await openResults(page, fake);
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await expect(dialog(page)).toBeVisible();
  const { findings } = await axeCheck(page, 'Results: the delete warning');
  expect(findings, describeFindings(findings)).toEqual([]);
  await expect(dialog(page).getByRole('button', { name: DELETE_SESSION.confirm })).toBeVisible();
  // Tab never reaches the page behind (it is inert): focus is in the dialog, or has left the page for the browser's own controls.
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  }
});

// A session that can be deleted is never the live one, so a page open on it is already at Welcome, saying its visit is not the active session.
test("a participant page open on a deleted session ends cleanly, and the deleted session's guest code says so in words (Phase 16)", async ({ page }) => {
  const { fake, tracks, code } = await site();
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}#/agenda?t=${tracks[1].id}`);
  await expect(page.getByRole('button', { name: /Click here to begin|Activities/ })).toBeVisible();
  await onSite(fake, async (ds) => {
    const { deleteSessionData } = await import('../../migration/src/lib/admin/session-delete.js');
    await deleteSessionData(OLD, { data: ds, gapMs: 0 });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // No retry storm: a few requests at most in the next five seconds.
  const before = fake.requests.length;
  await page.waitForTimeout(5_000);
  expect(fake.requests.length - before).toBeLessThan(6);
  await expect(page.locator('body')).not.toContainText(/Error|undefined|TypeError|Failed to fetch/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Its link opened afresh, in a page of its own: Welcome, never an error screen.
  const fresh = await page.context().newPage();
  await serveSharePoint(fresh, fake);
  await fresh.goto(`${pageUrl('index.html')}#/agenda?t=${tracks[1].id}`);
  await expect(fresh.getByRole('button', { name: /Click here to begin|Activities/ })).toBeVisible();
  await expect(fresh.locator('body')).not.toContainText(/Error|undefined|TypeError|Failed to fetch/);
  await expect(fresh.getByRole('alert')).toHaveCount(0);
  // The printed code of the deleted session.
  await page.goto(`${pageUrl('index.html')}?qr=${encodeURIComponent(code.id)}`);
  await expect(page.getByText("This QR code isn't recognized. Ask your facilitator for a new one.")).toBeVisible();
});

test('when the last session is deleted, focus goes to the Results heading and the screen says there are none (Phase 16)', async ({ page }) => {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    await ds.activateClient('c-kroger', '2026-10-09');
    await ds.updateAppSettings({ activeSessionId: null, activeClientId: null });
  });
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await card(page, OLD).getByRole('button', { name: DELETE_SESSION.button }).click();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: DELETE_SESSION.confirm })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Kroger 2026-10-09 deleted')).toBeVisible();
  await expect(page.getByText('No sessions yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused();
});
