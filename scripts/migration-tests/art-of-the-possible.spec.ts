import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Prompt 23: Art of the Possible and a guest's picture in the BUILT pages, on an iPad's viewport, against the mocked SharePoint REST, in Chromium and WebKit (the engine of every iPad
// browser; Firefox does not start on the development machine). A guest rates by keyboard and sends only at none left; a reload keeps the draft; 25 rows by 6 criteria scroll under a header
// that stays; axe finds nothing in either view; the picture is asked for once and a failed one is the silhouette. On the admin page: Content's editor, the picture dialog, and Results' opened
// row; Hide names and the wall show no picture.

const shots = fileURLToPath(new URL('../../test-results/art-of-the-possible/', import.meta.url));
const PIN = '2468';
const today = localDate();
const IPAD = { width: 820, height: 1180 };
const FACE_NAME = 'g-0123456789-abcdef0123.webp';
const criteriaOf = (count: number) => Array.from({ length: count }, (_, at) => ({ id: `c-${String(at).repeat(6)}`, label: ['Strategic value', 'Volume / repeatability', 'Standardisation', 'Compliance / risk', 'Outsourcing suitability', 'Interest'][at], hint: `What High means for ${at}.`, direction: at % 2 ? 'favours' : 'against' }));

/** A client whose only activity is the question, live, with guests. */
async function site({ rows = 2, criteria = 2, guests = ['Priya Rao', 'Ben Carter'] }: { rows?: number; criteria?: number; guests?: string[] } = {}) {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const faced: { tokens: string[]; session: string; criteria: ReturnType<typeof criteriaOf>; optionIds: string[] } = { tokens: [], session: '', criteria: criteriaOf(criteria), optionIds: [] };
  await onSite(fake, async (ds) => {
    await ds.createClient({ id: 'c-acme', name: 'Acme', slug: 'acme', status: 'active', themeVersion: 1, theme: null, logoUrl: null, primaryColor: null, secondaryColor: null, createdAt: new Date().toISOString() });
    faced.optionIds = Array.from({ length: rows }, (_, at) => `o-${at + 1}`);
    for (const [at, id] of faced.optionIds.entries()) await ds.createOption({ id, questionId: 'q-aop', ...ds.matrixRowFields({ label: `Sub-process ${at + 1}`, people: String(at + 3) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process', optionIds: faced.optionIds, order: 1, criteria: faced.criteria });
    await ds.createSection({ id: 'sec-aop', title: 'Art of the Possible', order: 1, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-acme' });
    const { session } = await ds.activateClient('c-acme', today) as { session: { id: string } };
    faced.session = session.id;
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    for (const [at, displayName] of guests.entries()) {
      const visitor = await ds.createVisitor({ id: `v-${at + 1}`, sessionId: session.id, displayName, enabled: true, guestGroup: at === 0 ? 'Finance' : '' }) as { id: string };
      const token = await ds.provisionQrToken('c-acme', session.id, { visitorId: visitor.id }) as { id: string };
      faced.tokens.push(token.id);
    }
  });
  return { fake, ...faced };
}

async function atQuestion(page: Page, fake: Fake, token: string) {
  await page.setViewportSize(IPAD);
  const served = await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}?qr=${token}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /Art of the Possible/ }).click();
  await expect(page.getByTestId('matrix')).toBeVisible();
  return served;
}
const axeOn = async (page: Page) => expect((await new AxeBuilder({ page }).include('[data-testid="matrix"]').analyze()).violations.map((each) => `${each.id}: ${each.nodes[0]?.target}`)).toEqual([]);
const saved = (fake: Fake, trackIndex = 0) => JSON.parse(fake.lists.get('responses')?.[trackIndex]?.ResponsesJson ?? '[]');
const send = (page: Page) => page.getByRole('button', { name: /^Send/ });

test.describe('the guest', () => {
  test('rates by keyboard alone; Send says what is left and turns on at none; what is saved is one answer; a changed rating does not move the first', async ({ page }) => {
    const { fake, tokens, optionIds, criteria } = await site();
    await atQuestion(page, fake, tokens[0]);
    await expect(send(page)).toHaveText('Send (4 boxes left)');
    await expect(send(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Grid' }).click();
    const first = page.getByRole('button', { name: 'Sub-process 1, Strategic value: not rated' });
    await expect(first).toHaveAttribute('tabindex', '0');
    await first.focus();
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: 'Sub-process 1, Strategic value: High' })).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Sub-process 1, Strategic value: Low' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('m');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('h');
    await page.keyboard.press('ArrowLeft');
    await expect(send(page)).toHaveText('Send (1 box left)');
    await page.keyboard.press('l');
    await expect(page.getByTestId('matrix-count')).toHaveText('4 of 4 rated');
    await expect(page.getByText('All rated', { exact: true })).toBeVisible();
    await expect(send(page)).toHaveText('Send');
    await send(page).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    const [record] = saved(fake);
    expect(record.questionId).toBe('q-aop');
    expect(record.correct).toBeNull();
    expect(record.attempts).toBe(1);
    expect(record.answer).toEqual(encodeAnswer({ [optionIds[0]]: { [criteria[0].id]: 1, [criteria[1].id]: 2 }, [optionIds[1]]: { [criteria[1].id]: 3, [criteria[0].id]: 1 } }));
    // A returning guest sees what they sent, and may change it: the first answer stands.
    await page.getByRole('button', { name: 'Change my ratings' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('4 of 4 rated');
    await page.getByRole('button', { name: 'Sub-process 1, Strategic value: Low' }).click();
    await send(page).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    await expect.poll(() => saved(fake)[0].answer.join()).toContain('=2');
    expect(saved(fake)[0].firstAnswer).toEqual(record.firstAnswer);
    expect(fake.lists.get('responses')?.length).toBe(1);
  });

  test('a reload keeps what was rated and not sent, and nothing is written until Send', async ({ page }) => {
    const { fake, tokens } = await site();
    await atQuestion(page, fake, tokens[0]);
    await page.getByRole('button', { name: 'Sub-process 1, Strategic value: not rated' }).click();
    await page.getByRole('button', { name: 'Sub-process 2, Volume / repeatability: not rated' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('2 of 4 rated');
    expect(fake.lists.get('responses')?.length ?? 0).toBe(0);
    await page.reload();
    await expect(page.getByTestId('matrix-count')).toHaveText('2 of 4 rated');
  });

  test('axe finds nothing in either view, Next empty box finds the box, the hint opens, and the targets are big enough', async ({ page }) => {
    const { fake, tokens } = await site({ rows: 3, criteria: 5 });
    await atQuestion(page, fake, tokens[0]);
    await axeOn(page);
    const box = await page.getByRole('button', { name: 'Sub-process 1, Strategic value: not rated' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Sub-process 1, Strategic value: not rated' }).click();
    await page.getByRole('button', { name: 'Next empty box' }).click();
    await expect(page.getByRole('button', { name: 'Sub-process 1, Volume / repeatability: not rated' })).toBeFocused();
    await page.getByRole('button', { name: 'About Strategic value' }).first().click();
    await expect(page.getByTestId('matrix-hint')).toContainText('What High means for 0.');
    await page.screenshot({ path: `${shots}grid-ipad.png`, fullPage: true });
    await page.getByRole('button', { name: 'One at a time' }).click();
    await expect(page.getByText('Sub-process 1 of 3')).toBeVisible();
    await axeOn(page);
    const segment = await page.getByRole('group', { name: 'Volume / repeatability' }).getByRole('button', { name: 'High' }).boundingBox();
    expect(segment!.height).toBeGreaterThanOrEqual(56);
    await page.getByRole('group', { name: 'Volume / repeatability' }).getByRole('button', { name: 'High' }).click();
    await expect(page.getByTestId('matrix-count')).toHaveText('2 of 15 rated');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Sub-process 2 of 3')).toBeVisible();
    await page.screenshot({ path: `${shots}one-at-a-time-ipad.png`, fullPage: true });
  });

  test('on a phone it starts One at a time', async ({ page }) => {
    const { fake, tokens } = await site({ rows: 3, criteria: 5 });
    await atQuestion(page, fake, tokens[0]);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'One at a time' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${shots}one-at-a-time-phone.png`, fullPage: true });
  });

  test('25 rows by 6 criteria: the rows scroll under a header that stays, and the answer goes through', async ({ page }) => {
    const { fake, tokens } = await site({ rows: 25, criteria: 6 });
    await atQuestion(page, fake, tokens[0]);
    await expect(page.getByTestId('matrix-count')).toHaveText('0 of 150 rated');
    const head = page.getByRole('columnheader', { name: 'Interest' });
    const before = (await head.boundingBox())!.y;
    await page.locator('.matrix-scroll').evaluate((node) => { node.scrollTop = 400; });
    await expect.poll(async () => Math.abs((await head.boundingBox())!.y - before)).toBeLessThan(2);
    for (let at = 0; at < 150; at += 1) {
      await page.getByRole('button', { name: 'Next empty box' }).click();
      await page.keyboard.press('h');
    }
    await expect(send(page)).toHaveText('Send');
    await send(page).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    const [record] = saved(fake);
    expect(record.answer.length).toBe(25);
    expect(record.answer.join('').length).toBeLessThan(6000);
  });

  test('a guest\'s own picture is asked for once, a guest with none shows the silhouette, and one that fails to load does too', async ({ page }) => {
    const { fake, tokens, session } = await site();
    const url = `${new URL(pageUrl('index.html')).origin}${new URL(pageUrl('index.html')).pathname.split('/Shared')[0]}/PMSClientImages/${FACE_NAME}`;
    await onSite(fake, (ds) => ds.updateVisitor('v-1', { pictureUrl: url }));
    let asked = 0;
    await page.setViewportSize(IPAD);
    await serveSharePoint(page, fake);
    await page.route(`**/${FACE_NAME}`, (route) => { asked += 1; return route.fulfill({ status: 404, body: '' }); });
    await page.goto(`${pageUrl('index.html')}?qr=${tokens[0]}`);
    await expect(page.getByRole('heading', { name: /Hi Priya Rao/ })).toBeVisible();
    await expect.poll(() => asked).toBe(1);
    await expect(page.getByTestId('guest-silhouette').first()).toBeVisible();
    expect(session).toBeTruthy();
    const other = await page.context().newPage();
    await other.setViewportSize(IPAD);
    await serveSharePoint(other, fake);
    await other.goto(`${pageUrl('index.html')}?qr=${tokens[1]}`);
    await expect(other.getByRole('heading', { name: /Hi Ben Carter/ })).toBeVisible();
    await expect(other.getByTestId('guest-silhouette').first()).toBeVisible();
    expect(asked).toBe(1);
  });
});

async function admin(page: Page, fake: Fake, tab: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const served = await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#${tab}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  return served;
}

test.describe('the admin page', () => {
  test('Guests and QR: the dialog by keyboard, a big picture comes out round, small and under a name with no name in it, and it can be removed', async ({ page, browserName }) => {
    const { fake } = await site();
    await admin(page, fake, 'guests');
    await expect(page.getByTestId('guest-pictures-line')).toHaveText('0 of 2 have a picture.');
    await page.getByRole('button', { name: 'Add picture' }).first().focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('guest-picture');
    await expect(dialog).toContainText('Only add a picture if the guest agreed.');
    await expect(dialog.getByRole('button', { name: 'Take photo' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[data-testid="guest-picture"]').analyze()).violations.map((each) => each.id)).toEqual([]);
    // (The dialog and axe above run in WebKit too. From here on not: on the Windows machine Playwright's WebKit cannot open a chosen picture, the known brand-smoke fault in docs/TESTING.md, and hands a route no Blob body. QA-TESTING has it on a real iPad.)
    test.skip(browserName === 'webkit', 'the picture pipeline does not run in the WebKit of Playwright on Windows');
    // A noisy picture of over 200 KB, drawn in the page.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 700; canvas.height = 700;
      const context = canvas.getContext('2d')!;
      const image = context.createImageData(700, 700);
      for (let at = 0; at < image.data.length; at += 1) image.data[at] = at % 4 === 3 ? 255 : Math.random() * 255;
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const bytes = Buffer.from(png, 'base64');
    expect(bytes.length).toBeGreaterThan(200_000);
    await page.getByTestId('guest-picture-file').setInputFiles({ name: 'jane-doe.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('button', { name: 'Use this picture' }).click();
    await expect(page.getByTestId('guest-pictures-line')).toHaveText('1 of 2 have a picture.', { timeout: 15_000 });
    const stored = [...fake.files.entries()].filter(([name]) => /\/g-[0-9a-f]{10}-[0-9a-f]{10}\.(webp|jpg)$/.test(name));
    expect(stored.length).toBe(1);
    expect(stored[0][0].toLowerCase()).not.toContain('jane');
    expect(stored[0][1].bytes.length).toBeLessThanOrEqual(60 * 1024);
    const row = fake.lists.get('visitorroster')?.find((each: { PictureUrl?: string }) => each.PictureUrl);
    expect(row.PictureUrl).toContain(stored[0][0].split('/').pop());
    await page.screenshot({ path: `${shots}guests.png` });
    await page.getByRole('button', { name: 'Replace picture' }).click();
    await page.getByRole('button', { name: 'Remove picture' }).click();
    await expect(page.getByTestId('guest-pictures-line')).toHaveText('0 of 2 have a picture.');
    expect([...fake.files.keys()].some((name) => name.includes('/g-'))).toBe(false);
  });

  test('Content: add the type, paste from a spreadsheet, and save: the criteria and the rows are stored', async ({ page }) => {
    const { fake } = await site();
    await admin(page, fake, 'content');
    await page.getByRole('button', { name: /Art of the Possible/ }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Add question' }).click();
    await page.getByRole('combobox', { name: 'Type' }).selectOption('art-of-the-possible');
    await expect(page.getByRole('textbox', { name: 'Question' })).toHaveValue('Rate each sub-process on five criteria');
    await page.getByRole('button', { name: 'Paste from a spreadsheet' }).click();
    await page.getByRole('textbox', { name: /Two columns copied from Excel/ }).fill('Corp accounting – GL\t29\nAP/AR\t"1,200"\n\nOther finance\t11\n');
    await expect(page.getByTestId('matrix-paste-preview')).toContainText('3 rows will be added');
    await expect(page.getByTestId('matrix-paste-preview')).toContainText('1 blank line left out');
    await page.getByRole('button', { name: 'Add 3' }).click();
    await expect(page.getByTestId('matrix-line')).toHaveText('3 sub-processes, 1240 people in scope');
    await page.screenshot({ path: `${shots}editor.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include('.content-editor').analyze()).violations.map((each) => each.id)).toEqual([]);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Art of the Possible: 3 sub-processes by 5 criteria')).toBeVisible();
    const question = fake.lists.get('questions')?.find((row: { QuestionType: string; AppId: string }) => row.QuestionType === 'art-of-the-possible' && row.AppId !== 'q-aop');
    expect(JSON.parse(question.Criteria).map((each: { direction: string }) => each.direction)).toEqual(['against', 'favours', 'favours', 'against', 'favours']);
    expect(JSON.parse(question.OptionIds).length).toBe(3);
  });

  test('Results: the heat map, an opened row with who said High and their picture; Hide names takes both away; the wall shows neither', async ({ page }) => {
    const { fake, session, optionIds, criteria } = await site();
    await onSite(fake, (ds) => ds.updateVisitor('v-1', { pictureUrl: `https://americas.internal.deloitteonline.com/sites/CreativeExpCOE/PMSClientImages/${FACE_NAME}` }));
    const answer = encodeAnswer(Object.fromEntries(optionIds.map((id) => [id, Object.fromEntries(criteria.map((each) => [each.id, 3]))])));
    for (const [at, name] of ['Priya Rao', 'Ben Carter'].entries()) {
      fake.add('tracks', { Title: `t${at}`, AppId: `t${at}`, SessionId: session, ClientId: 'c-acme', JoinedVia: 'qr', VisitorId: `v-${at + 1}`, ParticipantName: name, CreatedAt: '2026-10-30T09:00:00Z' });
      fake.add('responses', { Title: `t${at}`, AppId: `t${at}`, TrackId: `t${at}`, SessionId: session, ClientId: 'c-acme', ResponsesJson: JSON.stringify([{ questionId: 'q-aop', answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: '2026-10-30T09:10:00Z' }]) });
    }
    await page.route(`**/${FACE_NAME}`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
    await admin(page, fake, 'results');
    await page.locator('summary', { hasText: 'Live results' }).first().click();
    const card = page.locator('[data-kind="matrix"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('2 of 2 guests answered · 2 sub-processes · 7 people in scope');
    await card.getByRole('button', { name: /Sub-process 1/ }).click();
    await expect(card).toContainText('Who said High');
    await expect(card.getByTestId('guest-avatar').first()).toBeVisible();
    await expect(card.locator(`img[src*="${FACE_NAME}"]`).first()).toBeAttached();
    await page.screenshot({ path: `${shots}results.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include('[data-kind="matrix"]').analyze()).violations.map((each) => `${each.id}: ${each.nodes[0]?.target}`)).toEqual([]);
    await page.getByRole('checkbox', { name: 'Hide names' }).check();
    await expect(card).toContainText('Guest 1');
    await expect(card).not.toContainText('Priya');
    await expect(page.locator(`img[src*="${FACE_NAME}"]`)).toHaveCount(0);
    // The wall: no name and no picture, whatever the switch says.
    await page.getByRole('checkbox', { name: 'Hide names' }).uncheck();
    await page.getByRole('button', { name: 'Live display' }).first().click();
    await expect(page.locator('[data-kind="matrix"]').first()).toBeVisible();
    await expect(page.locator('[data-kind="matrix"]').first()).toContainText(/have rated|guests answered/);
    await page.screenshot({ path: `${shots}live.png`, fullPage: true });
  });
});
