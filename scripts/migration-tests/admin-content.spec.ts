import { test, expect, type Page } from '@playwright/test';
import {
  activityRow, activityTitles, addActivity, another, answerQuestions, ds, expectFits, openAdmin, participantUrl, pickClient, shoot, startLocal, stopLocal,
  today, viewports, type Local,
} from './admin-local.js';

// Phase 5b: the Content screen, scoped by client, end to end. The BUILT admin and participant pages
// against the REAL local server on a scratch copy of server/data, one server per test. What is on
// screen is what the data says, and what a participant sees is what the data says. Screenshots go to
// test-results/admin/ and are looked at, not only taken.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

const logoSvg = (text: string, fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="30" y="20" width="180" height="80" rx="40" fill="${fill}"/><text x="120" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="30" fill="#fff">${text}</text></svg>`;
const hub = (page: Page) => page.locator('button.activity');
const confirmWith = (page: Page, accept = true) => {
  const seen: string[] = [];
  page.once('dialog', (dialog) => { seen.push(dialog.message()); void (accept ? dialog.accept() : dialog.dismiss()); });
  return seen;
};
const dialogOf = (page: Page) => page.getByRole('dialog');

async function participantHub(browser: Parameters<typeof another>[0]) {
  const guest = await another(browser, local);
  await guest.page.goto(participantUrl);
  await guest.page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(guest.page.locator('button.activity').first()).toBeVisible();
  return guest;
}

// ---- Scoped by client ---------------------------------------------------------------------------------

test("the client switcher shows only that client's activities, and an activity made under Domino's is neither on Kroger's list nor on a Kroger participant page", async ({ page, browser }) => {
  await openAdmin(page, local, 'Content');
  // Nothing is live: the first active client by name.
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await expect(activityTitles(page)).toHaveText(["Domino's History", 'Guess the Innovation']);
  await pickClient(page, 'Kroger');
  await expect(activityTitles(page)).toHaveText(["Kroger's History", 'Guess the Brand', 'Confidence Continuum', 'Open Feedback', 'Straight Talk']);
  await expect(page.getByRole('heading', { name: 'Kroger activities' })).toBeVisible();

  await pickClient(page, "Domino's");
  await page.getByRole('button', { name: 'Add activity' }).click();
  await dialogOf(page).getByLabel('Name', { exact: true }).fill('Menu Deep Dive');
  await dialogOf(page).getByLabel('Description').fill('Pizzas, sides and desserts');
  await dialogOf(page).getByRole('button', { name: 'Add activity' }).click();
  await expect(activityTitles(page)).toHaveText(["Domino's History", 'Guess the Innovation', 'Menu Deep Dive']);
  const created = (await ds.listClientSections('c-dominos')).at(-1);
  expect(created).toMatchObject({ title: 'Menu Deep Dive', clientId: 'c-dominos', enabled: false, order: 3, description: 'Pizzas, sides and desserts', questionIds: [] });

  await pickClient(page, 'Kroger');
  await expect(activityTitles(page)).toHaveText(["Kroger's History", 'Guess the Brand', 'Confidence Continuum', 'Open Feedback', 'Straight Talk']);
  expect((await ds.listClientSections('c-kroger')).map((section: { title: string }) => section.title)).not.toContain('Menu Deep Dive');

  // Switch it on (it has no questions, so the screen asks first).
  await pickClient(page, "Domino's");
  const asked = confirmWith(page);
  await activityRow(page, created.id).locator('label.switch').click();
  await expect.poll(async () => (await ds.getSection(created.id)).enabled).toBe(true);
  expect(asked[0]).toContain('"Menu Deep Dive" has no questions');

  // A Kroger participant sees Kroger's switched-on activities and nothing of Domino's.
  await ds.activateClient('c-kroger', today);
  const kroger = await participantHub(browser);
  await expect(hub(kroger.page)).toHaveText([/Kroger's History/, /Guess the Brand/, /Confidence Continuum/, /Open Feedback/]);
  await kroger.context.close();
  // And a Domino's participant sees the new one beside Domino's own.
  await ds.activateClient('c-dominos', today);
  const dominos = await participantHub(browser);
  await expect(hub(dominos.page)).toHaveText([/Domino's History/, /Guess the Innovation/, /Menu Deep Dive/]);
  await dominos.context.close();
  await shoot(page, 'content-dominos-after-add', { full: false });
});

test('it opens on the live client; a client picked this visit stays picked while the live client is unchanged, and the screen follows a new live client', async ({ page }) => {
  await ds.createClient({ id: 'c-acme', name: 'Acme Foods', slug: 'acme-foods', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: new Date().toISOString(), themeVersion: 1 });
  await ds.activateClient('c-kroger', today);
  await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-kroger');
  await expect(page.locator('.content-client .pill--live')).toHaveText('LIVE NOW');
  await pickClient(page, "Domino's");
  await expect(page.locator('.content-client .pill--live')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  // Another client goes live: Content opens on it, whatever was picked before.
  await ds.activateClient('c-acme', today);
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-acme');
  // A reload forgets the visit and starts from what is live again.
  await pickClient(page, "Domino's");
  await page.reload();
  await page.getByRole('textbox', { name: 'PIN' }).fill('1234');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-acme');
});

// ---- An activity: rename, describe, switch, duplicate, reorder, delete ----------------------------------

test('an activity can be renamed and described, switched, duplicated, moved and deleted', async ({ page }) => {
  await openAdmin(page, local, 'Content');
  await pickClient(page, 'Kroger');

  // Rename: a name the client already has is refused, and nothing is written.
  await activityRow(page, 'sec-straight-talk').getByRole('button', { name: /Rename or describe/ }).click();
  const form = dialogOf(page);
  await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
  await form.getByLabel('Name', { exact: true }).fill('  guess  the BRAND ');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toContainText('already has an activity called "Guess the Brand"');
  expect((await ds.getSection('sec-straight-talk')).title).toBe('Straight Talk');
  await form.getByLabel('Name', { exact: true }).fill('Straight Talk, revised');
  await form.getByLabel('Description').fill('Plain answers to plain questions.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(activityRow(page, 'sec-straight-talk')).toContainText('Straight Talk, revised');
  await expect(activityRow(page, 'sec-straight-talk')).toContainText('Plain answers to plain questions.');
  expect(await ds.getSection('sec-straight-talk')).toMatchObject({ title: 'Straight Talk, revised', description: 'Plain answers to plain questions.' });

  // The live switch writes through, and says so.
  const straight = activityRow(page, 'sec-straight-talk');
  expect((await ds.getSection('sec-straight-talk')).enabled).toBe(false);
  await straight.locator('label.switch').click();
  await expect(page.locator('.toast')).toContainText('Straight Talk, revised is live');
  await expect.poll(async () => (await ds.getSection('sec-straight-talk')).enabled).toBe(true);

  // Duplicate: a whole copy beside the original, not live, with ids of its own.
  const original = await ds.getSection('sec-confidence');
  await activityRow(page, 'sec-confidence').getByRole('button', { name: 'Duplicate Confidence Continuum' }).click();
  await expect(activityTitles(page).last()).toHaveText('Confidence Continuum (copy)');
  const copy = (await ds.listClientSections('c-kroger')).find((section: { title: string }) => section.title === 'Confidence Continuum (copy)');
  expect(copy).toMatchObject({ enabled: false, clientId: 'c-kroger', order: 6 });
  expect(copy.id).not.toBe(original.id);
  expect(copy.questionIds).toHaveLength(original.questionIds.length);
  expect(copy.questionIds.every((id: string) => !original.questionIds.includes(id))).toBe(true);
  const copiedQuestion = await ds.getQuestion(copy.questionIds[0]);
  expect(copiedQuestion.optionIds).toHaveLength((await ds.getQuestion(original.questionIds[0])).optionIds.length);
  await expect(page.locator('.content-detail')).toContainText('Confidence Continuum (copy)');

  // Move: Open Feedback goes above Confidence Continuum. The order is the section's Order field, and focus stays on the control.
  const orderBefore = Object.fromEntries((await ds.listClientSections('c-kroger')).map((section: { id: string; order: number }) => [section.id, section.order]));
  expect([orderBefore['sec-confidence'], orderBefore['sec-open-feedback']]).toEqual([3, 4]);
  await activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback up' }).click();
  await expect(activityTitles(page)).toHaveText(["Kroger's History", 'Guess the Brand', 'Open Feedback', 'Confidence Continuum', 'Straight Talk, revised', 'Confidence Continuum (copy)']);
  await expect.poll(async () => Object.fromEntries((await ds.listClientSections('c-kroger')).map((section: { id: string; order: number }) => [section.id, section.order])), { message: 'both writes land' })
    .toMatchObject({ 'sec-open-feedback': 3, 'sec-confidence': 4 });
  await expect(activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback up' })).toBeFocused();
  await activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback up' }).click();
  await activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback up' }).click();
  await expect(activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback up' })).toBeDisabled();
  await expect(activityRow(page, 'sec-open-feedback').getByRole('button', { name: 'Move Open Feedback down' }), 'at the top the focus moves to the other arrow').toBeFocused();
  await expect(activityTitles(page).first()).toHaveText('Open Feedback');

  // Delete: cancelling keeps everything.
  const keep = confirmWith(page, false);
  await activityRow(page, 'sec-guess-the-brand').getByRole('button', { name: 'Delete Guess the Brand' }).click();
  await expect.poll(() => keep.length).toBe(1);
  expect(await ds.getSection('sec-guess-the-brand')).toBeTruthy();
});

test('deleting an activity or a question that has recorded answers says how many answers it orphans, and deletes every record of it', async ({ page }) => {
  const history = await ds.getSection('sec-trivia');
  // An earlier day of Kroger's holds an answer to the first question: the screen counts every session of the client, not only today's.
  // (Until Phase 10c-2a the local seed's own answers stood for that. They were in the older shared shape, which nothing reads now.)
  const earlier = await ds.activateClient('c-kroger', '2026-09-30');
  const before = await ds.beginVisit(crypto.randomUUID(), earlier.session.id, 'c-kroger');
  await answerQuestions(before.id, earlier.session.id, 'c-kroger', history.questionIds.slice(0, 1));
  const { session } = await ds.activateClient('c-kroger', today);
  const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
  const options = (await Promise.all(history.questionIds.map((id: string) => ds.getQuestion(id)))).flatMap((question: { optionIds: string[] }) => question.optionIds);
  await answerQuestions(track.id, session.id, 'c-kroger', history.questionIds.slice(0, 2));
  const everyAnswer = (await Promise.all((await ds.listSessions()).map((entry: { id: string }) => ds.readSessionResponses(entry.id)))).flat();
  const answersTo = (ids: string[]) => everyAnswer.filter((answer: { questionId: string }) => ids.includes(answer.questionId)).length;
  expect(answersTo([history.questionIds[0]]), 'the first question has today\'s answer and the earlier day\'s').toBe(2);
  expect(answersTo(history.questionIds)).toBe(3);
  await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-kroger');

  // A question first.
  await activityRow(page, 'sec-trivia').locator('.activity__select').click();
  const questionAsked = confirmWith(page, false);
  await page.locator('.content-detail .row').filter({ hasText: 'In 1883, Barney Kroger' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => questionAsked.length).toBe(1);
  expect(questionAsked[0]).toContain(`This also orphans ${answersTo([history.questionIds[0]])} recorded answers.`);
  expect(await ds.getQuestion(history.questionIds[0])).toBeTruthy();

  // Then the whole activity, which is live.
  const asked = confirmWith(page);
  await activityRow(page, 'sec-trivia').getByRole('button', { name: "Delete Kroger's History" }).click();
  await expect(activityRow(page, 'sec-trivia')).toHaveCount(0);
  expect(asked[0]).toContain('Delete "Kroger\'s History", its 5 questions and 20 options?');
  expect(asked[0]).toContain(`This also orphans ${answersTo(history.questionIds)} recorded answers.`);
  expect(asked[0]).toContain('It is live: participants stop seeing it at once.');
  expect(await ds.getSection('sec-trivia')).toBeNull();
  for (const id of history.questionIds) expect(await ds.getQuestion(id), id).toBeNull();
  for (const id of options) expect(await ds.getOption(id), id).toBeNull();
  expect((await ds.getSession(session.id)).sectionIds).not.toContain('sec-trivia');
  // The answers are not touched: they are the participant's record.
  expect((await ds.getParticipantResponses(track.id)).responses).toHaveLength(2);
  await expect(page.locator('.toast')).toContainText('"Kroger\'s History" is deleted');
});

// ---- Layout and pictures ----------------------------------------------------------------------------------

test('Layout and option pictures round-trip through the editor, and the participant pager draws a picture tile or a text tile to match', async ({ page, browser }) => {
  await page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: logoSvg(new URL(route.request().url()).pathname.slice(1, 5), '#0B648F') }));
  // An open flow, so the new activity (the third) is not locked behind the two before it.
  const { session } = await ds.activateClient('c-dominos', today);
  await ds.updateSession(session.id, { activityFlow: 'open' });
  await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await page.getByRole('button', { name: 'Add activity' }).click();
  await dialogOf(page).getByLabel('Name', { exact: true }).fill('Which logo?');
  await dialogOf(page).getByRole('button', { name: 'Add activity' }).click();
  await expect(activityTitles(page).last()).toHaveText('Which logo?');

  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Which of these is the pizza logo?');
  await page.getByLabel('Option 1 text').fill('Alpha');
  await page.getByLabel('Option 2 text').fill('Bravo');
  await page.getByRole('button', { name: '+ Add option' }).click();
  await page.getByLabel('Option 3 text').fill('Charlie');
  await expect(page.getByLabel(/picture address/), 'a list has no picture fields').toHaveCount(0);
  await page.getByLabel('Layout').selectOption('image-grid');
  await expect(page.getByLabel(/picture address/)).toHaveCount(3);
  await expect(page.getByTestId('tile-hint')).toContainText('A text tile will be used for any option with no picture (none has one yet, so every tile shows text)');
  // A link that is not a web address is refused, with the reason.
  await page.getByLabel('Option 1 picture address').fill('javascript:alert(1)');
  await expect(page.locator('.opt__preview').first()).toContainText('Use an address that starts with https://');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Option 1 (Alpha): Use an address that starts with https://');
  // Two pictures and one text tile.
  await page.getByLabel('Option 1 picture address').fill('https://img.test/alpha.svg');
  await page.getByLabel('Option 2 picture address').fill('https://img.test/bravo.svg');
  await expect(page.locator('.opt__preview img').first()).toHaveJSProperty('complete', true);
  await expect(page.locator('.opt__preview').nth(2)).toContainText('A text tile will be used');
  await shoot(page, 'content-question-picture-tiles', { full: false });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  const section = (await ds.listClientSections('c-dominos')).find((entry: { title: string }) => entry.title === 'Which logo?');
  const question = await ds.getQuestion(section.questionIds[0]);
  expect(question.layout).toBe('image-grid');
  const stored = await Promise.all(question.optionIds.map((id: string) => ds.getOption(id)));
  expect(stored.map((option: { label: string; imageUrl?: string | null }) => [option.label, option.imageUrl ?? null])).toEqual([['Alpha', 'https://img.test/alpha.svg'], ['Bravo', 'https://img.test/bravo.svg'], ['Charlie', null]]);

  // Switch it on; the participant page draws tiles: two pictures and one text tile.
  await activityRow(page, section.id).locator('label.switch').click();
  await expect.poll(async () => (await ds.getSection(section.id)).enabled).toBe(true);
  const guest = await participantHub(browser);
  await guest.page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: logoSvg('x', '#0B648F') }));
  await guest.page.getByRole('button', { name: 'Which logo?' }).click();
  await expect(guest.page.locator('.pms-options.pms-grid')).toBeVisible();
  await expect(guest.page.locator('.pms-options .tile')).toHaveCount(3);
  await expect(guest.page.locator('.pms-options .tile img')).toHaveCount(2);
  await expect(guest.page.locator('.pms-options .tile .text')).toHaveText(['Charlie']);
  await shoot(guest.page, 'participant-picture-and-text-tiles', { full: false });

  // Back to a list: the picture fields go, the stored layout says so, and the participant draws rows of text.
  await activityRow(page, section.id).locator('.activity__select').click();
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Layout')).toHaveValue('image-grid');
  await expect(page.getByLabel('Option 1 picture address')).toHaveValue('https://img.test/alpha.svg');
  await page.getByLabel('Layout').selectOption('text-list');
  await expect(page.getByLabel(/picture address/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  expect((await ds.getQuestion(question.id)).layout).toBe('text-list');
  expect((await ds.getOption(question.optionIds[0])).imageUrl, 'the picture is kept for when tiles are chosen again').toBe('https://img.test/alpha.svg');
  await guest.page.reload();
  await expect(guest.page.locator('.pms-options button')).toHaveCount(3);
  await expect(guest.page.locator('.pms-options.pms-grid')).toHaveCount(0);

  // Tiles again, and one picture is cleared: it is stored as none, and that tile is text.
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Layout').selectOption('image-grid');
  await page.getByLabel('Option 1 picture address').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  // (Polled: the toast may be the previous save's, so the write can still be on its way when it shows.)
  await expect.poll(async () => (await ds.getOption(question.optionIds[0])).imageUrl).toBeNull();
  await guest.page.reload();
  await expect(guest.page.locator('.pms-options .tile img')).toHaveCount(1);
  await expect(guest.page.locator('.pms-options .tile .text')).toHaveText(['Alpha', 'Charlie']);
  await guest.context.close();
});

test('an older question with no stored layout opens as tiles when every answer has a picture, and saving keeps what it was', async ({ page }) => {
  const id = await addActivity('c-dominos', { title: 'Older pictures', questions: [{ prompt: 'Pick one', options: [['One', null, 'https://img.test/1.svg'], ['Two', null, 'https://img.test/2.svg']] }] });
  await openAdmin(page, local, 'Content');
  await activityRow(page, id).locator('.activity__select').click();
  await expect(page.locator('.content-detail')).toContainText('picture tiles');
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Layout')).toHaveValue('image-grid');
  await page.getByLabel('Question', { exact: true }).fill('Pick one now');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  expect((await ds.getQuestion(`${id}-q0`)).layout).toBe('image-grid');
});

test('picking another activity while a question is being saved does not move the save to it', async ({ page }) => {
  await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await page.route('**/api/questions', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => { setTimeout(resolve, 700); });
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByLabel('Question', { exact: true }).fill('A question that takes a moment');
  await page.getByLabel('Option 1 text').fill('One');
  await page.getByLabel('Option 2 text').fill('Two');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await activityRow(page, 'sec-dominos-innovation').locator('.activity__select').click();
  await expect.poll(async () => (await ds.getSection('sec-dominos-history')).questionIds.length, { timeout: 10_000 }).toBe(6);
  expect((await ds.getSection('sec-dominos-innovation')).questionIds, 'the other activity was not touched').toHaveLength(3);
  await expect(activityRow(page, 'sec-dominos-history')).toContainText('6 questions');
  await expect(activityRow(page, 'sec-dominos-innovation')).toContainText('3 questions');
  await expect(page.locator('.content-detail')).toContainText('Guess the Innovation');
});

// ---- Preview, in the selected client's colours ---------------------------------------------------------------

test("Preview opens the real participant pager in the selected client's colours", async ({ page }) => {
  await openAdmin(page, local, 'Content');
  const frame = page.locator('.preview__frame');
  const mid = (id: string) => page.locator(`[data-activity="${id}"]`);
  const look = async (clientName: string, id: string) => {
    await pickClient(page, clientName);
    await mid(id).getByRole('button', { name: /^Preview / }).click();
    await expect(page.locator('dialog button.pill').first()).toBeVisible();
    return frame.evaluate((element) => ({
      client: (element as HTMLElement).dataset.client, source: (element as HTMLElement).dataset.themeSource, mid: getComputedStyle(element).getPropertyValue('--bg-mid').trim(),
      shell: getComputedStyle(element.shadowRoot!.querySelector('.shell')!).backgroundImage,
    }));
  };
  const dominos = await look("Domino's", 'sec-dominos-history');
  expect(dominos).toMatchObject({ client: 'c-dominos', source: 'stored', mid: '#0B648F' });
  expect(dominos.shell).toContain('rgb(11, 100, 143)');
  await expect(page.getByTestId('preview-look')).toHaveText("Look: Domino's");
  await shoot(page, 'content-preview-dominos', { full: false });
  await page.keyboard.press('Escape');
  const kroger = await look('Kroger', 'sec-trivia');
  expect(kroger).toMatchObject({ client: 'c-kroger', source: 'stored', mid: '#045BCC' });
  expect(kroger.shell).toContain('rgb(4, 91, 204)');
  await shoot(page, 'content-preview-kroger', { full: false });
  await page.keyboard.press('Escape');
  expect(await ds.getSection('sec-trivia')).toMatchObject({ enabled: true }); // looking changed nothing
});

// ---- Copy from another client ------------------------------------------------------------------------------------

async function openCopy(page: Page) {
  await page.getByRole('button', { name: 'Copy from another client...' }).click();
  await expect(dialogOf(page).getByRole('heading', { name: /^Copy activities to / })).toBeVisible();
}
const tick = (page: Page, title: string) => dialogOf(page).getByRole('checkbox', { name: new RegExp(`^${title}`) }).check();

test('copying from Kroger to Domino\'s: the counts are shown first, the copy has new ids, the same questions, is not live and goes last; copying again does nothing and says so', async ({ page }) => {
  const requests = await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await openCopy(page);
  const dialog = dialogOf(page);
  await expect(dialog.getByLabel('Copy from')).toHaveValue('c-kroger');
  await expect(dialog.getByRole('checkbox', { name: /^Kroger's History/ })).toBeVisible();
  await expect(dialog.locator('.copy-row').first()).toContainText('5 questions, 20 options');
  await expect(dialog.getByTestId('copy-summary')).toContainText('Tick the activities to copy.');
  await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  await tick(page, "Kroger's History");
  await tick(page, 'Guess the Brand');
  await expect(dialog.getByTestId('copy-summary')).toContainText("Copying 2 activities, 6 questions, 24 options to Domino's.");
  await expect(dialog.getByTestId('copy-summary')).toContainText('They start switched off');
  await shoot(page, 'content-copy-dialog', { full: false });
  const before = requests.length;
  await dialog.getByRole('button', { name: 'Copy 2 activities' }).click();
  await expect(dialog.getByTestId('copy-result')).toContainText("Copied 2 activities to Domino's. They are not live yet.");
  const writes = requests.slice(before).filter((entry) => entry.startsWith('POST '));
  expect(writes.filter((entry) => entry.startsWith('POST options')).length).toBe(24);
  expect(writes.filter((entry) => entry.startsWith('POST questions')).length).toBe(6);
  expect(writes.filter((entry) => entry.startsWith('POST sections')).length).toBe(2);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(activityTitles(page)).toHaveText(["Domino's History", 'Guess the Innovation', "Kroger's History", 'Guess the Brand']);

  const copies = (await ds.listClientSections('c-dominos')).filter((section: { id: string }) => section.id.includes('~'));
  expect(copies.map((section: { id: string; enabled: boolean; order: number; clientId: string }) => [section.id, section.enabled, section.order, section.clientId])).toEqual([
    ['sec-trivia~c-dominos', false, 3, 'c-dominos'], ['sec-guess-the-brand~c-dominos', false, 4, 'c-dominos'],
  ]);
  const source = await ds.getSection('sec-trivia');
  const copy = copies[0];
  expect(copy.questionIds).toEqual(source.questionIds.map((id: string) => `${id}~c-dominos`));
  const [sourceQuestions, copiedQuestions] = await Promise.all([Promise.all(source.questionIds.map((id: string) => ds.getQuestion(id))), Promise.all(copy.questionIds.map((id: string) => ds.getQuestion(id)))]);
  expect(copiedQuestions.map((question: { prompt: string; type: string; order: number }) => [question.prompt, question.type, question.order])).toEqual(sourceQuestions.map((question: { prompt: string; type: string; order: number }) => [question.prompt, question.type, question.order]));
  const sourceOptions = await Promise.all(sourceQuestions[0].optionIds.map((id: string) => ds.getOption(id)));
  const copiedOptions = await Promise.all(copiedQuestions[0].optionIds.map((id: string) => ds.getOption(id)));
  expect(copiedOptions.map((option: { label: string; correct: boolean | null }) => [option.label, option.correct])).toEqual(sourceOptions.map((option: { label: string; correct: boolean | null }) => [option.label, option.correct]));
  expect(copiedOptions.every((option: { questionId: string }) => option.questionId === copiedQuestions[0].id)).toBe(true);
  expect((await ds.getSection('sec-trivia')).enabled, 'the source is untouched').toBe(true);

  // Again: both are there already, which the dialog says before and after; a third is copied beside them.
  await openCopy(page);
  await expect(dialog.locator('.copy-row').first()).toContainText("Domino's already has it");
  await tick(page, "Kroger's History");
  await tick(page, 'Guess the Brand');
  await expect(dialog.getByTestId('copy-summary')).toContainText('Nothing to copy.');
  await expect(dialog.getByTestId('copy-summary')).toContainText('Skipping 2 that Domino\'s already has: "Kroger\'s History", "Guess the Brand".');
  await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  await tick(page, 'Confidence Continuum');
  await expect(dialog.getByTestId('copy-summary')).toContainText("Copying 1 activity, 1 question, 3 options to Domino's.");
  await expect(dialog.getByTestId('copy-summary')).toContainText('Skipping 2 that Domino\'s already has');
  await dialog.getByRole('button', { name: 'Copy 1 activity' }).click();
  await expect(dialog.getByTestId('copy-result')).toContainText('Copied 1 activity');
  await expect(dialog.getByTestId('copy-result'), 'what was skipped is said again, after').toContainText('Skipped: "Kroger\'s History" is already one of this client\'s activities.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  expect((await ds.listClientSections('c-dominos')).length).toBe(5);
});

test('a copy that fails part way leaves no half-built activity, the others are copied, and running it again completes only what is missing', async ({ page }) => {
  const requests = await openAdmin(page, local, 'Content');
  let optionWrites = 0;
  let failing = true;
  await page.route('**/api/options', async (route) => {
    // The 8th option written, inside the first activity (20 options), is refused.
    if (route.request().method() === 'POST' && failing && (optionWrites += 1) === 8) return route.fulfill({ status: 503, json: { error: 'Injected failure' } });
    return route.fallback();
  });
  await openCopy(page);
  const dialog = dialogOf(page);
  await tick(page, "Kroger's History");
  await tick(page, 'Guess the Brand');
  await dialog.getByRole('button', { name: 'Copy 2 activities' }).click();
  const result = dialog.getByTestId('copy-result');
  await expect(result).toContainText("Copied 1 activity to Domino's");
  await expect(result).toContainText('Not copied: "Kroger\'s History" (Injected failure). Nothing of it was kept.');
  await expect(result).toContainText('Run it again to copy what is missing');
  await expect(result).toHaveClass(/copy-result--warning/);
  await shoot(page, 'content-copy-partial-failure', { full: false });

  // Nothing of the failed activity is in the data: no activity, no question, no option.
  const left = await Promise.all([ds.getSection('sec-trivia~c-dominos'), ...['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5'].map((id) => ds.getQuestion(`${id}~c-dominos`))]);
  expect(left.every((record) => record === null)).toBe(true);
  expect((await ds.listOptions()).filter((option: { id: string }) => option.id.startsWith('o-trivia-') && option.id.endsWith('~c-dominos'))).toEqual([]);
  expect((await ds.getSection('sec-guess-the-brand~c-dominos')).questionIds).toHaveLength(1);

  // Run it again: only the activity that was not whole is written.
  failing = false;
  const before = requests.length;
  await dialog.getByRole('button', { name: 'Run it again' }).click();
  await expect(result).toContainText("Copied 1 activity to Domino's");
  const writes = requests.slice(before).filter((entry) => entry.startsWith('POST '));
  expect(writes.filter((entry) => entry.startsWith('POST options')).length).toBe(20);
  expect(writes.filter((entry) => entry.startsWith('POST questions')).length).toBe(5);
  expect(writes.filter((entry) => entry.startsWith('POST sections')).length).toBe(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(activityTitles(page)).toHaveText(["Domino's History", 'Guess the Innovation', 'Guess the Brand', "Kroger's History"]);
  expect((await ds.getSection('sec-trivia~c-dominos')).questionIds).toHaveLength(5);
});

test('an archived client is not the first choice, and cannot have activities added or copied into it', async ({ page }) => {
  await ds.updateClient('c-dominos', { status: 'archived' });
  await openAdmin(page, local, 'Content');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-kroger'); // the archived one is not the first choice
  await pickClient(page, "Domino's");
  await expect(page.locator('.content-client .pill--archived')).toHaveText('Archived');
  await expect(page.getByRole('button', { name: 'Add activity' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy from another client...' })).toBeDisabled();
});

// ---- Everything the old Activities tab did is reachable --------------------------------------------------------------

test('every capability of the old Activities tab is in Content: the list, the live switch, Preview, and the old address', async ({ page }) => {
  // One of Kroger's that is switched off, to switch on and off again.
  await ds.createSection({ id: 'loose', title: 'Loose activity', order: 9, enabled: false, industryTags: [], questionIds: ['q-trivia-1'], clientId: 'c-kroger' });
  await openAdmin(page, local);
  await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('tab')).toHaveText(['Today', 'Clients', 'Content', 'Guests and QR', 'Results']);
  // The old address for the Activities tab lands on Content.
  await page.evaluate(() => { window.location.hash = '#sections'; });
  await page.reload();
  await page.getByRole('textbox', { name: 'PIN' }).fill('1234');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');

  // Every activity, whichever client it belongs to, has a switch, a Preview and a question count.
  for (const [client, id, title, count] of [["Domino's", 'sec-dominos-history', "Domino's History", '5 questions'], ['Kroger', 'sec-trivia', "Kroger's History", '5 questions']] as const) {
    await pickClient(page, client);
    const row = activityRow(page, id);
    await expect(row).toContainText(count);
    await expect(row.getByRole('checkbox', { name: `Set ${title} live` })).toBeChecked();
    await expect(row.getByRole('button', { name: `Preview ${title}` })).toBeVisible();
  }
  const loose = activityRow(page, 'loose');
  await expect(loose.getByRole('checkbox', { name: 'Set Loose activity live' })).not.toBeChecked();
  await loose.locator('label.switch').click();
  await expect(page.locator('.toast')).toContainText('Loose activity is live');
  await expect.poll(async () => (await ds.getSection('loose')).enabled).toBe(true);
  await loose.locator('label.switch').click();
  await expect.poll(async () => (await ds.getSection('loose')).enabled).toBe(false);
  // Preview, with its own live switch, opens the real pager and closes with Escape.
  await loose.getByRole('button', { name: 'Preview Loose activity' }).click();
  await expect(page.locator('dialog button.pill').first()).toBeVisible();
  await page.getByRole('button', { name: 'Go live' }).click();
  await expect.poll(async () => (await ds.getSection('loose')).enabled).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(loose.getByRole('checkbox', { name: 'Set Loose activity live' })).toBeChecked();
});

test("the live switches follow what another admin does, with one read of the activities every 15 seconds", async ({ page }) => {
  await page.clock.install();
  const requests = await openAdmin(page, local, 'Content');
  await pickClient(page, 'Kroger');
  const box = activityRow(page, 'sec-straight-talk').getByRole('checkbox', { name: 'Set Straight Talk live' });
  await expect(box).not.toBeChecked();
  await ds.updateSection('sec-straight-talk', { enabled: true });
  const before = requests.length;
  await page.clock.runFor(15_000);
  await expect(box).toBeChecked();
  expect(requests.slice(before).filter((entry) => entry.startsWith('GET sections'))).toHaveLength(1);
});

// ---- Layout, keyboard, screenshots ---------------------------------------------------------------------------------

test('Content fits 390, 820 and 1440 wide, with its dialogs: no sideways scroll, 44px targets, and screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  for (const id of ['loose-1', 'loose-2']) await ds.createSection({ id, title: `Spare activity with a longer name ${id}`, order: 8, enabled: false, industryTags: [], questionIds: ['q-trivia-1'], clientId: 'c-dominos' });
  const logos = await addActivity('c-dominos', { title: 'Logos', enabled: false, questions: [{ prompt: 'Which logo?', layout: 'image-grid', options: [['Alpha', null, 'https://img.test/a.svg'], ['Bravo', null]] }] });
  await page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: logoSvg('Logo', '#0B648F') }));
  await ds.activateClient('c-dominos', today);
  for (const size of viewports) {
    const tag = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await openAdmin(page, local, 'Content');
    await expect(activityTitles(page).first()).toBeVisible();
    await expectFits(page, `Content at ${tag}`);
    await shoot(page, `content-${tag}`);

    // The question editor, on picture tiles.
    await activityRow(page, logos).locator('.activity__select').click();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByLabel('Option 1 picture address')).toBeVisible();
    await expectFits(page, `Content, question editor at ${tag}`);
    await shoot(page, `content-editor-${tag}`);
    await page.getByRole('button', { name: 'Cancel' }).click();

    for (const [name, open, close] of [
      ['add-activity', async () => page.getByRole('button', { name: 'Add activity' }).click(), async () => page.getByRole('button', { name: 'Cancel' }).click()],
      ['copy', async () => { await page.getByRole('button', { name: 'Copy from another client...' }).click(); await dialogOf(page).getByRole('checkbox', { name: /^Kroger's History/ }).check(); }, async () => page.getByRole('button', { name: 'Cancel' }).click()],
    ] as const) {
      await open();
      await expect(dialogOf(page)).toBeVisible();
      await expectFits(page, `Content, ${name} dialog at ${tag}`);
      expect(await dialogOf(page).evaluate((element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight; }), `${name} dialog inside the screen at ${tag}`).toBe(true);
      await shoot(page, `content-${name}-dialog-${tag}`, { full: false });
      await close();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }
  }
});

test('keyboard: the controls come in reading order and show the green ring, dialogs take focus and give it back, Escape closes them', async ({ page }) => {
  await ds.activateClient('c-dominos', today);
  await openAdmin(page, local, 'Content');
  await expect(activityTitles(page).first()).toBeVisible();
  const order: string[] = [];
  const rings: string[] = [];
  // (A keyboard focus: in Firefox a script's focus() alone is not one, so go away and come back with the keys.)
  await page.getByLabel('Client', { exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  // (Phase 18: the strip's chosen view and the line that opens Brand come after the client picker; two more stops keep the rest as they were.)
  for (let step = 0; step < 15; step += 1) {
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { name: (element.getAttribute('aria-label') || (element.tagName === 'SELECT' ? element.id : element.textContent?.trim()) || element.id || element.tagName).replace(/\s+/g, ' ').slice(0, 40), outline: `${style.outlineStyle} ${style.outlineWidth}`, halo: style.boxShadow !== 'none' };
    });
    order.push(focused.name);
    if (focused.outline !== 'solid 3px' || !focused.halo) rings.push(`${focused.name} ${focused.outline}`);
    await page.keyboard.press('Tab');
  }
  expect(rings, 'every stop draws the 3px green ring with its halo').toEqual([]);
  expect(order).toEqual([
    // (Phase 9b, SAM-2: Domino's is a sample client, so "Mark as confirmed" is the next stop after the two buttons, before the activities.)
    // (Prompt 20: a client without a confidence check offers to add one, above its activities: one stop more, so the list ends a stop earlier.)
    'content-client', expect.stringContaining('Activities'), 'Open Brand', 'Add activity', 'Copy from another client...', 'Mark as confirmed', 'Add a confidence check', expect.stringContaining("Domino's History"), "Set Domino's History live", "Preview Domino's History",
    "Rename or describe Domino's History", "Duplicate Domino's History", "Move Domino's History down", "Delete Domino's History", expect.stringContaining('Guess the Innovation'),
  ]);

  // Dialogs: focus goes in, Escape comes out, and the button that opened it has the focus again.
  await page.getByRole('button', { name: 'Add activity' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialogOf(page).getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add activity' })).toBeFocused();
  await page.getByRole('button', { name: 'Copy from another client...' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialogOf(page).getByLabel('Copy from')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Copy from another client...' })).toBeFocused();
  await page.getByRole('button', { name: "Rename or describe Domino's History" }).focus();
  await page.keyboard.press('Enter');
  await expect(dialogOf(page).getByLabel('Name', { exact: true })).toBeFocused();
  await expect(dialogOf(page).getByLabel('Name', { exact: true })).toHaveValue("Domino's History");
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: "Rename or describe Domino's History" })).toBeFocused();
});
