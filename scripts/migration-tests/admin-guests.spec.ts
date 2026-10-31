import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { qrImage } from '../../migration/src/lib/admin/admin-links.js';
import {
  another, answerQuestions, ds, expectFits, openAdmin, participantUrl, shoot, shots, startLocal, stopLocal, today, viewports, type Local,
} from './admin-local.js';

// Phase 5b: Guests and QR, upgraded: pasting a list of names, one code for every guest, a status for
// each guest read from real data, a print sheet of QR cards, and the list as a CSV. The BUILT admin
// page against the REAL local server on a scratch copy of server/data, one server per test.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

type Visitor = { id: string; displayName: string; enabled?: boolean };
type Token = { id: string; visitorId: string; used: boolean; expiredAt?: string | null; sessionId: string };

/** Kroger live, with guests scanning a personal QR. */
async function guestSession(names: string[] = []) {
  const { session } = await ds.activateClient('c-kroger', today);
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const visitors: Visitor[] = [];
  for (const name of names) visitors.push(await ds.createVisitor({ sessionId: session.id, displayName: name, enabled: true }));
  return { session, visitors };
}
const names = (count: number) => Array.from({ length: count }, (_, index) => `Guest ${String(index + 1).padStart(2, '0')}`);
const row = (page: Page, name: string) => page.locator(`[data-guest="${name.toLowerCase()}"]`);
const tokensOf = async (sessionId: string): Promise<Token[]> => (await ds.listQrTokens()).filter((token: Token) => token.sessionId === sessionId);
const livePage = (page: Page) => page.getByRole('button', { name: 'Refresh' }).click();
/** The session's guests, read the way the admin reads them. */
const rosterOf = async (sessionId: string): Promise<Visitor[]> => (await ds.readLists([{ list: 'visitorroster', where: { sessionId } }]))[0];
/** What a guest's device does with its code: the scan, then the claim. Rejects when the code cannot be used. */
const scan = async (tokenId: string) => (await ds.openQrScan(tokenId)).claim();

// ---- Pasting names ------------------------------------------------------------------------------------------

test('a pasted list is read before anything is saved: blank lines, commas, repeats, long names; and adding it twice adds nobody', async ({ page }) => {
  const { session } = await guestSession();
  await openAdmin(page, local, 'Guests and QR');
  const paste = page.getByLabel('Paste names');
  const summary = page.getByTestId('paste-summary');
  const add = page.getByRole('button', { name: /^Add (\d+ guests?|guests)$/ });
  await expect(add).toBeDisabled();
  await paste.fill(`  Jordan   Lee \n\nCasey Park, Morgan Day;Riley Fox\njordan lee\n${'A'.repeat(80)}\nSomeone, \n   \n`);
  await expect(summary).toContainText('6 new, 1 duplicate skipped.');
  await expect(summary).toContainText('1 name shortened to 60 characters; 3 blank lines ignored.');
  await expect(add).toHaveText('Add 6 guests');
  expect(await rosterOf(session.id), 'nothing is saved until Add').toEqual([]);
  await add.click();
  await expect(page.getByTestId('guest-report')).toHaveText('Added 6 guests.');
  await expect(paste).toHaveValue('');
  const roster = await rosterOf(session.id);
  expect(roster.map((visitor: Visitor) => visitor.displayName).sort()).toEqual(['A'.repeat(60), 'Casey Park', 'Jordan Lee', 'Morgan Day', 'Riley Fox', 'Someone']);
  expect(roster.every((visitor: Visitor & { enabled: boolean }) => visitor.enabled === true)).toBe(true);
  await expect(page.locator('li.row[data-guest]')).toHaveCount(6);
  await expect(page.getByTestId('guest-summary')).toContainText('6 guests: 6 no code, 0 not scanned, 0 joined, 0 completed.');

  // The same list again, and a name that differs only in case and spacing: nothing new.
  await paste.fill('Jordan Lee\nCASEY   PARK\nRiley Fox');
  await expect(summary).toContainText('0 new, 3 duplicates skipped.');
  await expect(page.getByRole('button', { name: 'Add guests', exact: true })).toBeDisabled();
  // Another admin adds one while this page still shows the old roster: it is skipped when saving, against the roster as it is.
  await ds.createVisitor({ sessionId: session.id, displayName: 'Taylor Quinn', enabled: true });
  await paste.fill('Taylor Quinn\nBrand New');
  await expect(summary).toContainText('2 new, 0 duplicates skipped.');
  await page.getByRole('button', { name: 'Add 2 guests' }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Added 1 guest. 1 name was already on the list.');
  expect((await rosterOf(session.id)).filter((visitor: Visitor) => visitor.displayName === 'Taylor Quinn')).toHaveLength(1);

  // The single field refuses a name that is on the list, whatever its case.
  await page.getByRole('textbox', { name: 'Visitor name' }).fill('riley   fox');
  await page.getByRole('button', { name: 'Add visitor' }).click();
  await expect(page.getByRole('alert')).toContainText('riley fox is already on the list.');
  await shoot(page, 'guests-bulk-paste', { full: false });
});

// ---- One code for every guest -----------------------------------------------------------------------------------

test('Generate all codes makes one single-use code for each guest without one, shows progress, and pressing it again makes nothing', async ({ page }) => {
  const { session, visitors } = await guestSession(names(6));
  await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitors[0].id }); // one already has a code
  await ds.setVisitorEnabled(visitors[1].id, false); // one is switched off
  const requests = await openAdmin(page, local);
  // A little latency, so the progress can be seen.
  await page.route('**/api/qrtokens', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => { setTimeout(resolve, 120); });
    return route.fallback();
  });
  await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
  await expect(page.getByTestId('guest-summary')).toContainText('6 guests: 4 no code, 1 not scanned, 0 joined, 0 completed, 1 disabled.');
  const generate = page.getByRole('button', { name: /^Generate all codes/ });
  await expect(generate).toHaveText('Generate all codes (4)');
  const before = requests.length;
  await generate.click();
  await expect(page.getByTestId('guest-progress')).toContainText('Making codes');
  await expect(page.getByTestId('guest-report')).toHaveText('Made 4 codes. Everyone who can scan has one.');
  const writes = requests.slice(before).filter((entry) => entry.startsWith('POST qrtokens'));
  expect(writes, 'one write per code, nothing more').toHaveLength(4);
  await expect(page.getByTestId('guest-summary')).toContainText('6 guests: 0 no code, 5 not scanned, 0 joined, 0 completed, 1 disabled.');
  const tokens = (await tokensOf(session.id)).filter((token) => !token.expiredAt);
  expect(tokens).toHaveLength(5);
  expect(new Set(tokens.map((token) => token.visitorId)).size, 'one each').toBe(5);
  expect(tokens.every((token) => token.used === false)).toBe(true);
  expect(tokens.some((token) => token.visitorId === visitors[1].id), 'the disabled guest has none').toBe(false);
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveText('Generate all codes');

  // A guest is added: one is missing, and one more is made. Nothing else is touched.
  await ds.createVisitor({ sessionId: session.id, displayName: 'Late Guest', enabled: true });
  await livePage(page);
  await expect(generate).toHaveText('Generate all codes (1)');
  const second = requests.length;
  await generate.click();
  await expect(page.getByTestId('guest-report')).toHaveText('Made 1 code. Everyone who can scan has one.');
  expect(requests.slice(second).filter((entry) => entry.startsWith('POST qrtokens'))).toHaveLength(1);
  expect((await tokensOf(session.id)).filter((token) => !token.expiredAt)).toHaveLength(6);
  await shoot(page, 'guests-generated', { full: false });
});

test('a failed write stops being a problem on the next press: the codes made stay, and only the missing ones are made', async ({ page }) => {
  const { session } = await guestSession(names(5));
  await openAdmin(page, local, 'Guests and QR');
  let posts = 0;
  await page.route('**/api/qrtokens', async (route) => {
    if (route.request().method() === 'POST' && (posts += 1) === 3) return route.fulfill({ status: 503, json: { error: 'Injected failure' } });
    return route.fallback();
  });
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect(page.getByTestId('guest-report')).toContainText('Made 4 codes. 1 guest has no code yet (Injected failure). Press Generate all codes again');
  await expect(page.getByTestId('guest-report')).toHaveClass(/guests-report--warning/);
  expect((await tokensOf(session.id)).length).toBe(4);
  await expect(page.getByRole('button', { name: /^Generate all codes/ })).toHaveText('Generate all codes (1)');
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Made 1 code. Everyone who can scan has one.');
  expect((await tokensOf(session.id)).length).toBe(5);
});

test('each guest has a status from real data: No code, Not scanned, Joined, Completed, Disabled', async ({ page }) => {
  const { session, visitors } = await guestSession(['Ann', 'Bo', 'Cy', 'Dee', 'Eve']);
  const [ann, bo, cy, dee, eve] = visitors;
  const codes = Object.fromEntries(await Promise.all([ann, bo, cy, dee].map(async (visitor) => [visitor.displayName, await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id })])));
  await ds.setVisitorEnabled(eve.id, false);
  await openAdmin(page, local, 'Guests and QR');
  const status = async (name: string) => row(page, name).getAttribute('data-status');
  expect(await Promise.all(['Ann', 'Bo', 'Cy', 'Dee', 'Eve'].map(status))).toEqual(['waiting', 'waiting', 'waiting', 'waiting', 'disabled']);
  await expect(row(page, 'Ann')).toContainText('Not scanned');
  // Guests scan: Ann and Bo join, Dee finishes every live question, Bo answers some.
  const kroger = await ds.listClientSections('c-kroger');
  const liveQuestions = kroger.filter((section: { enabled: boolean }) => section.enabled).flatMap((section: { questionIds: string[] }) => section.questionIds);
  // (One after another: this process is one "page" of the data service, and a page scans one code at a time.)
  const scanned = [];
  for (const visitor of [ann, bo, dee]) scanned.push(await scan(codes[visitor.displayName].id));
  const [annTrack, boTrack, deeTrack] = scanned;
  await answerQuestions(deeTrack.id, session.id, 'c-kroger', liveQuestions);
  await answerQuestions(boTrack.id, session.id, 'c-kroger', liveQuestions.slice(0, 2));
  await livePage(page);
  await expect(row(page, 'Ann')).toHaveAttribute('data-status', 'joined');
  await expect(row(page, 'Bo')).toHaveAttribute('data-status', 'joined');
  await expect(row(page, 'Dee')).toHaveAttribute('data-status', 'completed');
  await expect(row(page, 'Cy')).toHaveAttribute('data-status', 'waiting');
  await expect(row(page, 'Eve')).toHaveAttribute('data-status', 'disabled');
  await expect(row(page, 'Dee')).toContainText('Completed');
  await expect(page.getByTestId('guest-summary')).toContainText('5 guests: 0 no code, 1 not scanned, 2 joined, 1 completed, 1 disabled.');
  // Ann finishes too: a wrong first try that is still open is not finished, a revealed one is.
  await ds.saveParticipantResponses({
    trackId: annTrack.id, sessionId: session.id, clientId: 'c-kroger',
    responses: liveQuestions.map((questionId: string, index: number) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: index === 0 ? 1 : 1, correct: index === 0 ? false : null, answeredAt: new Date().toISOString() })),
  });
  await livePage(page);
  await expect(row(page, 'Ann'), 'a wrong first try with a retry still to come').toHaveAttribute('data-status', 'joined');
  await ds.saveParticipantResponses({
    trackId: annTrack.id, sessionId: session.id, clientId: 'c-kroger',
    responses: liveQuestions.map((questionId: string, index: number) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: index === 0 ? 2 : 1, correct: index === 0 ? false : null, answeredAt: new Date().toISOString() })),
  });
  await livePage(page);
  await expect(row(page, 'Ann'), 'two wrong tries reveal the answer: settled').toHaveAttribute('data-status', 'completed');
});

test('the actions that were there stay: show a code, replace it, the new visit code, disable, and the recent entries', async ({ page }) => {
  const { session, visitors } = await guestSession(['Jordan Lee']);
  await ds.recordUserVisit({ id: 'visit-1', sessionId: session.id, clientId: 'c-kroger', entryMode: 'client-visit', visitorName: 'Earlier Guest', visitedAt: new Date().toISOString() });
  await openAdmin(page, local, 'Guests and QR');
  const guest = row(page, 'Jordan Lee');
  const link = page.getByRole('textbox', { name: 'Participant link' });
  await expect(guest).toContainText('No code');
  await guest.getByRole('button', { name: 'Generate QR' }).click();
  await expect.poll(async () => (await tokensOf(session.id)).length).toBe(1);
  const first = (await tokensOf(session.id))[0];
  await expect(page.getByRole('img', { name: /Single-use check-in QR code for Jordan Lee/ })).toBeVisible();
  await expect(link).toHaveValue(new RegExp(`/index\\.html\\?qr=${first.id}$`));
  // Show opens the same code: no new one is made.
  await link.evaluate((element: HTMLInputElement) => { element.value = ''; });
  await guest.getByRole('button', { name: 'Show QR' }).click();
  await expect(link).toHaveValue(new RegExp(`\\?qr=${first.id}$`));
  expect(await tokensOf(session.id)).toHaveLength(1);
  // Replace retires it and makes another.
  await guest.getByRole('button', { name: 'Replace code' }).click();
  await expect.poll(async () => (await tokensOf(session.id)).length).toBe(2);
  const [old, second] = await tokensOf(session.id);
  expect((await ds.getQrToken(old.id)).used, 'the replaced code no longer works').toBe(true);
  await expect(link).toHaveValue(new RegExp(`\\?qr=${second.id}$`));
  // Scanned: Joined, and a new code is for another visit.
  await scan(second.id);
  await livePage(page);
  await expect(guest).toContainText('Joined');
  await guest.getByRole('button', { name: 'New visit code' }).click();
  await expect.poll(async () => (await tokensOf(session.id)).length).toBe(3);
  await expect(guest).toContainText('Joined');
  await expect(guest.getByRole('button', { name: 'Show QR' })).toBeVisible();
  // Disable retires what is waiting, and the guest cannot be given a code.
  await guest.getByRole('button', { name: 'Disable' }).click();
  await expect(guest).toContainText('Disabled');
  expect((await ds.getQrToken((await tokensOf(session.id))[2].id)).expiredAt).toBeTruthy();
  await guest.getByRole('button', { name: 'Enable' }).click();
  await expect(guest).not.toContainText('Disabled');
  await expect(page.getByRole('heading', { name: 'Recent app entries' })).toBeVisible();
  await expect(page.getByText('Earlier Guest')).toBeVisible();
  expect(visitors).toHaveLength(1);
});

// ---- The QR link, and the print sheet --------------------------------------------------------------------------------

/** The address the page hands out for the participant page: the page's own folder, or this machine's LAN address when the admin is on localhost. */
async function expectedBase() {
  const lan = (await ds.getLanUrls()) as string[];
  return new URL(`${participantUrl}`, lan[0] ?? 'http://127.0.0.1:5188').href;
}

async function sheetOf(page: Page, count: number, { extra = true } = {}) {
  const { session, visitors } = await guestSession(names(count + (extra ? 3 : 0)));
  const withCodes = visitors.slice(0, count);
  for (const visitor of withCodes) await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
  if (extra) {
    // One has no code, one has joined, one is switched off: none of them gets a card.
    const [, joined, off] = visitors.slice(count);
    await scan((await ds.provisionQrToken('c-kroger', session.id, { visitorId: joined.id })).id);
    await ds.setVisitorEnabled(off.id, false);
  }
  await openAdmin(page, local, 'Guests and QR');
  await page.getByRole('button', { name: /^Print QR sheet/ }).click();
  await expect(page.getByTestId('print-view')).toBeVisible();
  await expect(page.locator('[data-card]')).toHaveCount(count);
  return { session, visitors: withCodes };
}

test('the print sheet has a card for each guest with a code waiting: name, QR, client and "Scan to begin", the QR carrying the participant page and the live session\'s code', async ({ page }) => {
  const { session, visitors } = await sheetOf(page, 25);
  await expect(page.getByTestId('print-summary')).toContainText('25 cards on 3 pages, 12 to a page, for Kroger');
  await expect(page.getByTestId('print-summary')).toContainText('Not on the sheet: 1 with no code, 1 who already joined, 1 disabled.');
  expect(await page.locator('.print-page').evaluateAll((pages) => pages.map((entry) => entry.querySelectorAll('[data-card]').length))).toEqual([12, 12, 1]);
  const first = page.locator('[data-card]').first();
  await expect(first.locator('.print-card__name')).toHaveText('Guest 01');
  await expect(first.locator('.print-card__client')).toHaveText('Kroger');
  await expect(first.locator('.print-card__cta')).toHaveText('Scan to begin');

  // Every card's code is a real, unused code of the live session for that guest; its address is the participant page and the token.
  const base = await expectedBase();
  const tokens = (await tokensOf(session.id)).filter((token) => !token.expiredAt);
  for (const visitor of visitors) {
    const token = tokens.find((entry) => entry.visitorId === visitor.id)!;
    const card = page.locator('[data-card]').filter({ has: page.getByRole('heading', { name: visitor.displayName, exact: true }) });
    const url = await card.locator('img').getAttribute('data-qr-url');
    expect(url, visitor.displayName).toBe(ds.qrUrl(token.id, base));
    expect(url).toContain('/index.html?qr=');
    expect(new URL(url!).searchParams.get('qr')).toBe(token.id);
    expect(token).toMatchObject({ sessionId: session.id, used: false });
    // The picture is the QR code of exactly that address.
    expect(await card.locator('img').getAttribute('src')).toBe(await qrImage(url!));
  }
  await shoot(page, 'guests-print-view-screen', { full: false });
  // Back to the roster.
  await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  await expect(page.getByRole('heading', { name: 'Guests and QR', exact: true })).toBeVisible();
  await expect(page.getByTestId('print-view')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('#guests');
});

test('printed: 3 by 4 cards of 61 mm on A4 and on US Letter, 12 to a page, no card split across pages, and the PDF has the pages it should', async ({ page, browserName }) => {
  await sheetOf(page, 25);
  await page.emulateMedia({ media: 'print' });
  const papers = [
    { name: 'a4', format: 'A4' as const, widthMm: 210, heightMm: 297 },
    { name: 'letter', format: 'Letter' as const, widthMm: 215.9, heightMm: 279.4 },
  ];
  const px = (mm: number) => (mm * 96) / 25.4;
  for (const paper of papers) {
    await page.setViewportSize({ width: Math.round(px(paper.widthMm)), height: Math.round(px(paper.heightMm)) });
    await expect(page.locator('.no-print').first()).toBeHidden();
    const layout = await page.evaluate(() => {
      const rect = (element: Element) => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top + window.scrollY, right: box.right, bottom: box.bottom + window.scrollY, width: box.width, height: box.height }; };
      return [...document.querySelectorAll('.print-page')].map((page, index, all) => ({
        box: rect(page), breakAfter: getComputedStyle(page).breakAfter, last: index === all.length - 1,
        cards: [...page.querySelectorAll('[data-card]')].map((card) => ({ ...rect(card), breakInside: getComputedStyle(card).breakInside })),
      }));
    });
    // The browser takes 8 mm off each edge of the paper (@page margin); the sheet must fit what is left.
    const marginPx = px(8);
    const printable = { width: px(paper.widthMm) - 2 * marginPx, height: px(paper.heightMm) - 2 * marginPx };
    expect(layout.map((entry) => entry.cards.length), `${paper.name}: cards per page`).toEqual([12, 12, 1]);
    for (const [index, entry] of layout.entries()) {
      const across = Math.max(...entry.cards.map((card) => card.right)) - Math.min(...entry.cards.map((card) => card.left));
      expect(across, `${paper.name} page ${index + 1}: the cards across fit the printable width`).toBeLessThanOrEqual(printable.width + 0.5);
      expect(entry.box.height, `${paper.name} page ${index + 1} fits the printable height`).toBeLessThanOrEqual(printable.height + 0.5);
      expect(entry.last ? 'auto' : 'page', `${paper.name}: a page break after every page but the last`).toBe(entry.breakAfter === 'always' ? 'page' : entry.breakAfter);
      for (const card of entry.cards) {
        expect(card.width, 'a card is 61 mm wide').toBeCloseTo(px(61), 0);
        expect(card.height, 'and 61 mm tall').toBeCloseTo(px(61), 0);
        expect(card.breakInside, 'and never split').toMatch(/avoid/);
        expect(card.top >= entry.box.top - 0.5 && card.bottom <= entry.box.bottom + 0.5, `${paper.name}: a card stays inside its page`).toBe(true);
      }
    }
    // The first page: 3 columns and 4 rows, no overlap.
    const first = layout[0].cards;
    expect(new Set(first.map((card) => Math.round(card.left))).size, 'three columns').toBe(3);
    expect(new Set(first.map((card) => Math.round(card.top))).size, 'four rows').toBe(4);
    for (const [index, card] of first.entries()) for (const other of first.slice(index + 1)) {
      expect(card.right <= other.left + 0.5 || other.right <= card.left + 0.5 || card.bottom <= other.top + 0.5 || other.bottom <= card.top + 0.5, 'cards do not overlap').toBe(true);
    }
    await shoot(page, `guests-print-${paper.name}`, { full: false });
  }

  if (browserName === 'chromium') {
    // The real print path: the PDF Chromium makes at each paper size has exactly the pages the cards need.
    const pagesOf = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    for (const paper of papers) {
      const pdf = await page.pdf({ format: paper.format, printBackground: true });
      expect(pagesOf(pdf), `${paper.name}: 25 cards are 3 pages`).toBe(3);
      await writeFile(`${shots}guests-print-${paper.name}.pdf`, pdf); // to be looked at: the first page of each
    }
  }
});

test('12 cards are one printed page and 13 are two, on both papers', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'page.pdf() is Chromium only');
  const { session, visitors } = await sheetOf(page, 13, { extra: false });
  const pagesOf = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  await page.emulateMedia({ media: 'print' });
  for (const format of ['A4', 'Letter'] as const) expect(pagesOf(await page.pdf({ format, printBackground: true })), `13 cards on ${format}`).toBe(2);
  await ds.setVisitorEnabled(visitors[12].id, false);
  await page.emulateMedia({ media: 'screen' });
  await page.reload();
  await page.getByRole('textbox', { name: 'PIN' }).fill('1234');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('[data-card]')).toHaveCount(12); // the address #print-guests opens the sheet again
  await page.emulateMedia({ media: 'print' });
  for (const format of ['A4', 'Letter'] as const) expect(pagesOf(await page.pdf({ format, printBackground: true })), `12 cards on ${format}`).toBe(1);
  expect(session.id).toBeTruthy();
});

test('long names fit their card and the sheet says when there is nothing to print', async ({ page }) => {
  const { session, visitors } = await guestSession(['Wolfgang Amadeus Chrysostomus Wolfgangus Theophilus Mozartiano', 'Al', 'Ünal Çelik-Ødegård']);
  for (const visitor of visitors) await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
  await openAdmin(page, local, 'Guests and QR');
  await page.getByRole('button', { name: /^Print QR sheet/ }).click();
  await expect(page.locator('[data-card]')).toHaveCount(3);
  await page.emulateMedia({ media: 'print' });
  const fit = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.print-card__name')].map((name) => ({ text: name.textContent, clipped: name.scrollHeight > name.clientHeight + 1, within: name.getBoundingClientRect().height <= (12 / 25.4) * 96 + 1 })));
  expect(fit.map((entry) => [entry.text, entry.within])).toEqual([['Al', true], ['Ünal Çelik-Ødegård', true], ['Wolfgang Amadeus Chrysostomus Wolfgangus Theophilus Mozartiano', true]]);
  await shoot(page, 'guests-print-long-names', { full: false });
  await page.emulateMedia({ media: 'screen' });
  // With every code scanned there is nothing to print: the button says so, and the sheet says why.
  for (const token of await tokensOf(session.id)) await scan(token.id);
  await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Print QR sheet' })).toBeDisabled();
});

// ---- The list as a file ------------------------------------------------------------------------------------------

test('Export CSV downloads the guests: name, code status, joined or not, safe to open in a spreadsheet', async ({ page }) => {
  const { session, visitors } = await guestSession(['Lee, Jordan "JJ"', '=HYPERLINK("http://x")', 'Zoë Ångström', 'Pat Joined', 'Una Off']);
  await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitors[2].id });
  await scan((await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitors[3].id })).id);
  await ds.setVisitorEnabled(visitors[4].id, false);
  await openAdmin(page, local, 'Guests and QR');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`guests-kroger-${today}.csv`);
  const text = await readFile((await file.path())!, 'utf8');
  expect(text.charCodeAt(0), 'a byte-order mark, so accents survive').toBe(0xfeff);
  expect(text.slice(1).split('\r\n')).toEqual([
    'Name,Code status,Joined',
    '"\'=HYPERLINK(""http://x"")",No code,No',
    '"Lee, Jordan ""JJ""",No code,No',
    'Pat Joined,Joined,Yes',
    'Una Off,Disabled,No',
    'Zoë Ångström,Not scanned,No',
    '',
  ]);
});

// ---- Layout, keyboard, screenshots ------------------------------------------------------------------------------------

test('Guests and QR and the print view fit 390, 820 and 1440 wide: no sideways scroll, 44px targets, and screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await sheetOf(page, 14);
  await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  for (const size of viewports) {
    const tag = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await expect(page.getByRole('heading', { name: 'Visitor roster' })).toBeVisible();
    await expectFits(page, `Guests and QR at ${tag}`);
    await shoot(page, `guests-roster-${tag}`);
    await page.getByRole('button', { name: /^Print QR sheet/ }).click();
    await expect(page.locator('[data-card]').first()).toBeVisible();
    await expectFits(page, `Print view at ${tag}`);
    // The sheet is shown smaller on a narrow screen, whole: all three columns are on the screen, never cropped.
    const place = () => page.locator('.print-page').first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      const cards = [...element.querySelectorAll('[data-card]')].slice(0, 3).map((card) => card.getBoundingClientRect());
      return { left: box.left, right: box.right, width: window.innerWidth, columns: cards.every((card) => card.left >= 0 && card.right <= window.innerWidth) };
    });
    // (The sheet is made smaller a frame after the window changed size: WebKit takes a frame longer than Chromium to get there.)
    await expect.poll(async () => (await place()).left, { message: `the sheet is brought onto the screen at ${tag}` }).toBeGreaterThanOrEqual(0);
    const sheet = await place();
    expect(sheet.left, `the sheet starts on the screen at ${tag}`).toBeGreaterThanOrEqual(0);
    expect(sheet.right, `and ends on it at ${tag}`).toBeLessThanOrEqual(sheet.width + 0.5);
    expect(sheet.columns, `with all three columns whole at ${tag}`).toBe(true);
    await shoot(page, `guests-print-view-${tag}`);
    await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  }
});

test('keyboard: the guest controls come in reading order and show the green ring', async ({ page }) => {
  await guestSession(names(2));
  await openAdmin(page, local, 'Guests and QR');
  await expect(page.locator('li.row[data-guest]')).toHaveCount(2);
  await page.getByRole('button', { name: /^Generate all codes/ }).focus();
  // Focus given by a script draws no ring until a key has been used: move off and back with the keyboard.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const order: string[] = [];
  const rings: string[] = [];
  for (let step = 0; step < 14; step += 1) { // (11 until Prompt 23: the form's Picture, and each row's Add picture)
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { name: (element.getAttribute('aria-label') || element.textContent?.trim() || element.id || element.tagName).replace(/\s+/g, ' ').slice(0, 30), outline: `${style.outlineStyle} ${style.outlineWidth}`, halo: style.boxShadow !== 'none' };
    });
    order.push(focused.name);
    if (focused.outline !== 'solid 3px' || !focused.halo) rings.push(`${focused.name} ${focused.outline}`);
    await page.keyboard.press('Tab');
  }
  expect(rings).toEqual([]);
  // Print is off while no code is waiting, so the order skips it.
  // (Prompt 21, Phase 4: a guest's group adds a field after the pasted names, one for lines with none, and one after the visitor's name.)
  expect(order).toEqual(['Generate all codes (2)', 'Export CSV', 'Refresh', 'paste-names', 'group-for-lines', 'visitor-name-field', 'visitor-group-field', 'Picture, optional', 'Add picture', 'Disable', 'Generate QR', 'Add picture', 'Disable', 'Generate QR'].map((name) => (name.endsWith('-field') || name === 'group-for-lines' ? expect.stringMatching(/./) : name)));
});

// ---- The participant, for completeness ----------------------------------------------------------------------------------

test('a guest who scans the code on a card lands on the participant page with their own name', async ({ page, browser }) => {
  const { session, visitors } = await guestSession(['Jordan Lee']);
  await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitors[0].id });
  await openAdmin(page, local, 'Guests and QR');
  await page.getByRole('button', { name: /^Print QR sheet/ }).click();
  const url = (await page.locator('[data-card] img').first().getAttribute('data-qr-url'))!;
  const token = new URL(url).searchParams.get('qr')!;
  const guest = await another(browser, local);
  await guest.page.goto(`${participantUrl}?qr=${token}`);
  await expect(guest.page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await guest.context.close();
  await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  await livePage(page);
  await expect(row(page, 'Jordan Lee')).toHaveAttribute('data-status', 'joined');
});
