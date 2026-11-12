import { test, expect, type Page } from '@playwright/test';
import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { mockApi } from './fixtures.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { sharePointFolderPath } from '../deployment-config.js';

// Prompt 44 (the behaviour-preserving refactor): a picture of every admin screen and every participant screen, against seeded data, with motion
// off and the clock held, so that a step of the refactor that changes a pixel is found. Run it with `npm run test:refactor` (its config is
// migration/playwright.refactor.config.ts); the "before" pictures are kept in test-results/refactor-before/ and recorded once on the untouched
// branch with `-- --update-snapshots`. A page whose pixels differ by more than 0.1% fails. Chromium only: it compares the page with itself.
//
// The admin page is signed in as a Super admin on the mocked SharePoint REST (the sample pack, eight sessions, six guests' answers and an Art of the
// Possible question in Kroger's newest session, as admin-full-width.spec.ts builds it). The participant page runs on the synthetic API
// (fixtures.ts), with one activity for each kind of question.

const NOW = new Date('2026-10-20T10:30:00');
const DAY = '2026-10-20';
const mail = (name: string) => `${name}@deloitte.com`;
const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
const CRITERIA = [['Strategic value', 'against'], ['Volume / repeatability', 'favours'], ['Standardisation', 'favours'], ['Compliance / risk', 'against'], ['Outsourcing suitability', 'favours']]
  .map(([label, direction], at) => ({ id: `c-a0000${at}`, label, hint: `High: ${label.toLowerCase()}.`, direction }));
const ROWS = [['Corp accounting – GL', 29, 'high'], ['AP / AR', 28, 'high'], ['Other finance', 11, 'split'], ['Treasury', 8, 'low']] as const;
const DATES = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];

/** The admin's site. Every stored time is a fixed one, so the pictures do not depend on when the test runs. */
async function adminSite(): Promise<Fake> {
  const fake = newFake({ user: ME });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    const optionIds = ROWS.map((_, at) => `o-aop-${at + 1}`);
    for (const [at, [label, people]] of ROWS.entries()) await ds.createOption({ id: optionIds[at], questionId: 'q-aop', ...ds.matrixRowFields({ label, people: String(people) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds, order: 1, criteria: CRITERIA });
    await ds.createSection({ id: 'sec-aop', title: 'The Art of Possibility', order: 99, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-kroger' });
    for (const [at, date] of DATES.entries()) await ds.activateClient(at % 2 ? 'c-dominos' : 'c-kroger', date);
    const { session } = await ds.activateClient('c-kroger', DAY) as { session: { id: string; sectionIds: string[] } };
    const questions = (await ds.listQuestions() as { id: string; sectionId: string; type: string }[]).filter((question) => session.sectionIds.includes(question.sectionId));
    const options = await ds.listOptions() as { id: string; questionId: string; correct?: boolean | null }[];
    for (let guest = 0; guest < 6; guest += 1) {
      const trackId = `t-guest-${guest + 1}`;
      const createdAt = `${DAY}T09:0${guest}:00.000Z`;
      fake.add('tracks', { AppId: trackId, Title: trackId, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'qr', ParticipantName: `Guest ${guest + 1}`, CreatedAt: createdAt, ResumeCount: 0, LastResumedAt: null, RestartedAt: null, RestartSectionId: null, QrTokenId: null, VisitorId: null, SharePointUserId: null });
      const records = [];
      for (const question of questions) {
        const own = options.filter((option) => option.questionId === question.id);
        if (question.type === 'art-of-the-possible') {
          const grid = Object.fromEntries(optionIds.map((id, at) => [id, Object.fromEntries(CRITERIA.map((criterion) => {
            const tilt = ROWS[at][2];
            const towards = tilt === 'split' ? guest % 2 === 0 : tilt === 'high';
            return [criterion.id, criterion.direction === 'favours' ? (towards ? 3 : 1) : (towards ? 1 : 3)];
          }))]));
          const answer = encodeAnswer(grid);
          records.push({ questionId: question.id, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: createdAt });
        } else if (['single-select', 'true-false'].includes(question.type) && own.length) {
          const pick = own[guest % own.length].id;
          records.push({ questionId: question.id, answer: pick, firstAnswer: pick, attempts: 1, correct: own.find((option) => option.id === pick)?.correct ?? null, answeredAt: createdAt });
        }
      }
      fake.add('responses', { AppId: trackId, Title: trackId, SessionId: session.id, TrackId: trackId, ClientId: 'c-kroger', ResponsesJson: JSON.stringify(records) });
    }
  });
  fake.add('users', { Title: ME.Email, AppId: ME.Email, FullName: ME.Title, Email: ME.Email, Status: 'Active', Source: 'Typed' });
  fake.add('users', { Title: mail('pulmathur'), AppId: mail('pulmathur'), FullName: 'Mathur, Pulkit', Email: mail('pulmathur'), Status: 'Active', Source: 'Typed' });
  for (const [who, role] of [[ME.Email, 'Super admin'], [mail('pulmathur'), 'Admin']]) {
    fake.add('roleassignments', { Title: `${who}|${role}`, AppId: `${who}|${role}|global|`, UserKey: who, Role: role, ScopeType: 'global', ClientId: '', SessionId: '', Extras: '' });
  }
  // (The data layer stamps what it makes with the time it was made, "Live since" among them: every such time is held to one, so the pictures do
  // not depend on when the test runs.)
  const realToday = new Date().toISOString().slice(0, 10);
  for (const items of (fake.lists as unknown as Map<string, Record<string, unknown>[]>).values()) {
    for (const item of items) {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string' && value.startsWith(`${realToday}T`)) item[key] = `${DAY}T08:00:00.000Z`;
      }
    }
  }
  return fake;
}

/** Motion off, the clock held, the fonts in: what makes two pictures of one screen the same. */
async function steady(page: Page, width = 1440, height = 900) {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height });
}
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => Promise.all(document.getAnimations().map((each) => each.finished.catch(() => undefined))));
  await page.waitForTimeout(150);
}
const shot = async (page: Page, name: string) => {
  await settle(page);
  // (A clock or a "just now" that moves with the real time would differ between runs: they are masked.)
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask: [page.locator('[data-volatile], time, .toast')] });
};
const tab = async (page: Page, name: string) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
};

async function openAdmin(page: Page, width = 1440, hash = '') {
  await steady(page, width);
  await serveSharePoint(page, await adminSite());
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  if (hash === '#print-guests') { await expect(page.getByRole('heading').first()).toBeVisible(); return; }
  await expect(page.getByTestId('identity-chip')).toBeVisible();
  const welcome = page.getByTestId('welcome-strip');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Got it' }).click();
}

test.describe('the admin page, every screen', () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the shell and Today at ${width}`, async ({ page }) => {
      await openAdmin(page, width);
      await shot(page, `admin-today-${width}`);
      await page.getByRole('button', { name: /^Change/ }).first().click();
      await shot(page, `admin-today-settings-${width}`);
    });
  }

  test('Clients, Content, Guests, Results, People at 1440', async ({ page }) => {
    await openAdmin(page);
    await tab(page, 'Clients');
    await shot(page, 'admin-clients');
    await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
    await expect(page.locator('.clients__detail')).toBeVisible();
    await shot(page, 'admin-clients-open');

    await tab(page, 'Content');
    await expect(page.locator('.content-activities')).toBeVisible();
    await shot(page, 'admin-content-activities');
    await page.locator('.content-strip__tab[data-view="brand"]').click();
    await expect(page.locator('.brand__preview')).toBeVisible();
    await shot(page, 'admin-content-brand');

    await tab(page, 'Guests and QR');
    await shot(page, 'admin-guests');

    await tab(page, 'Results');
    await expect(page.locator('article.card[data-session]')).toBeVisible();
    await expect(page.locator('.tally__grid').first()).toBeVisible();
    await shot(page, 'admin-results-session');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.dash')).toBeVisible();
    await shot(page, 'admin-results-dashboard');

    await tab(page, 'People');
    await shot(page, 'admin-people');
    await page.getByRole('button', { name: /^Open .*Pulkit/ }).click();
    await expect(page.locator('.people__detail')).toBeVisible();
    await shot(page, 'admin-people-open');
  });

  test('the QR sheet and the Live display at 1440', async ({ page }) => {
    await openAdmin(page, 1440, '#print-guests');
    await shot(page, 'admin-qr-sheet');
  });

  test('the Live display at 1440', async ({ page }) => {
    await openAdmin(page, 1440, '#live-display');
    await expect(page.getByRole('heading', { name: 'Live results', level: 2 })).toBeVisible();
    await shot(page, 'admin-live-display');
  });

  test('Setup at 1440', async ({ page }) => {
    await steady(page);
    await serveSharePoint(page, await adminSite());
    await page.goto(pageUrl('setup.html'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'setup');
  });
});

/** The participant's content: one activity for each kind of question, and a confidence check when asked. */
async function participant(page: Page, { live = true, check = false } = {}) {
  const fixture = await mockApi(page);
  const { records } = fixture;
  records.sections.length = 0;
  records.questions.length = 0;
  records.options.length = 0;
  const kinds: { type: string; prompt: string; options: [string, boolean | null, number?][]; criteria?: unknown }[] = [
    { type: 'single-select', prompt: 'Which year did the first store open?', options: [['1883', true], ['1900', false], ['1912', false], ['1916', false]] },
    { type: 'multi-select', prompt: 'Pick any: which channels do you use?', options: [['Phone', null], ['Email', null], ['App', null], ['In person', null]] },
    { type: 'true-false', prompt: 'True or false: the harbour opened in 1887.', options: [['True', true], ['False', false]] },
    { type: 'confidence-continuum', prompt: 'How confident are you in the plan?', options: [['Not confident', null, 1], ['Fairly confident', null, 2], ['Very confident', null, 3]] },
    { type: 'ranked-voting', prompt: 'Rank what mattered most', options: [['Speed', null], ['Quality', null], ['Price', null]] },
    { type: 'open-text-feedback', prompt: 'What would you change?', options: [] },
    { type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', options: ROWS.map(([label, people]) => [label, null, people] as [string, null, number]), criteria: CRITERIA },
  ];
  kinds.forEach((kind, order) => {
    const id = `k${order}`;
    const optionIds = kind.options.map((_, at) => `${id}-o${at}`);
    records.sections.push({ id: `section-${id}`, title: `Activity ${order + 1}: ${kind.type}`, description: `One ${kind.type} question.`, enabled: true, order, questionIds: [`q-${id}`], clientId: 'client-a' } as never);
    records.questions.push({ id: `q-${id}`, sectionId: `section-${id}`, prompt: kind.prompt, type: kind.type, optionIds, order: 1, layout: 'text-list', ...(kind.criteria ? { criteria: kind.criteria } : {}) } as never);
    kind.options.forEach(([label, correct, value], at) => records.options.push({ id: optionIds[at], questionId: `q-${id}`, label, correct, ...(value !== undefined ? { value } : {}) } as never));
  });
  if (check) {
    const labels = ['Not confident at all', 'Slightly confident', 'Moderately confident', 'Confident', 'Very confident'];
    records.sections.push({ id: 'section-check', title: 'Confidence check', description: 'Asked at the start and the end.', enabled: true, order: -1, questionIds: ['q-check'], clientId: 'client-a', kind: 'confidence-check' } as never);
    records.questions.push({ id: 'q-check', sectionId: 'section-check', prompt: 'How confident are you that Deloitte can deliver this?', type: 'confidence-continuum', optionIds: labels.map((_, at) => `chk-${at}`), order: 1, layout: 'text-list' } as never);
    labels.forEach((label, at) => records.options.push({ id: `chk-${at}`, questionId: 'q-check', label, value: at + 1, correct: null } as never));
  }
  for (const session of records.sessions) {
    session.sectionIds = [...(check ? ['section-check'] : []), ...kinds.map((_, order) => `section-k${order}`)];
    if (check) Object.assign(session, { confidenceCheck: true });
  }
  Object.assign(fixture.records.tracks[0], { visitorId: 'visitor-jordan', participantName: 'Jordan Lee', createdAt: `${DAY}T09:00:00.000Z` });
  if (!live) Object.assign(records.appsettings[0], { activeSessionId: '', activeClientId: '' });
  return fixture;
}
const at = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;

test.describe('the participant page, every screen', () => {

  test('Welcome, the agenda, each kind of question, Thank you', async ({ page }) => {
    await steady(page, 1180, 820);
    await participant(page);
    await page.goto(at('#/welcome?t=track-a'));
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await shot(page, 'participant-welcome');
    await page.goto(at('#/agenda?t=track-a'));
    await expect(page.getByRole('button', { name: /Activity 1/ })).toBeVisible();
    await shot(page, 'participant-agenda');
    for (let order = 0; order < 7; order += 1) {
      await page.goto(at(`#/quiz/section-k${order}?t=track-a`));
      await expect(page.locator('main h1, main h2').first()).toBeVisible();
      await shot(page, `participant-question-${order}`);
    }
    // The Art of the Possible, rated: every box High, through the box's menu.
    await page.goto(at('#/quiz/section-k6?t=track-a'));
    await expect(page.getByTestId('matrix')).toBeVisible();
    const all = page.getByRole('button', { name: 'All at once' });
    if (await all.count()) await all.click();
    for (const [row] of ROWS) {
      for (const criterion of CRITERIA) {
        await page.getByRole('button', { name: new RegExp(`^${row.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, ${criterion.label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: `) }).click();
        await page.getByRole('menu').getByRole('menuitemradio', { name: /^High/ }).click();
      }
    }
    await shot(page, 'participant-aop-rated');
  });

  test('Thank you, every activity answered', async ({ page }) => {
    await steady(page, 1180, 820);
    const fixture = await participant(page);
    const grid = Object.fromEntries(ROWS.map((_, row) => [`k6-o${row}`, Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, 3]))]));
    fixture.give([
      { questionId: 'q-k0', answer: 'k0-o0' }, { questionId: 'q-k1', answer: ['k1-o0', 'k1-o2'] }, { questionId: 'q-k2', answer: 'k2-o0' },
      { questionId: 'q-k3', answer: 'k3-o1' }, { questionId: 'q-k4', answer: ['k4-o1', 'k4-o0', 'k4-o2'] }, { questionId: 'q-k5', answer: 'More time for questions.' },
      { questionId: 'q-k6', answer: encodeAnswer(grid) },
    ]);
    await page.goto(at('#/thank-you?t=track-a'));
    await expect(page.getByText(/Thank you/).first()).toBeVisible();
    await shot(page, 'participant-thank-you');
  });

  test('the confidence check', async ({ page }) => {
    await steady(page, 1180, 820);
    await participant(page, { check: true });
    await page.goto(at('#/check-in?t=track-a'));
    await expect(page.getByText('How confident are you that Deloitte can deliver this?')).toBeVisible();
    await shot(page, 'participant-confidence');
  });

  test('not live', async ({ page }) => {
    await steady(page, 1180, 820);
    await participant(page, { live: false });
    await page.goto(at(''));
    await expect(page.locator('main').first()).toBeVisible();
    await shot(page, 'participant-not-live');
  });
});

